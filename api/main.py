from datetime import datetime, timezone
from functools import lru_cache
import json
import logging
import os
from pathlib import Path
from uuid import UUID, uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from api.service import analyze, graph_view, samples
from baseline.vector_index import Encoder, VectorIndex
from data.model import CACHE, OUT, ROOT, Document, read_manifest
from data.recorded import corpus, initial_edges
from hydra.contract import Hydra
from hydra.learn import Ledger, create_edges, feedback_ledger, send_feedback

load_dotenv()
app = FastAPI(title="Precedent", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("WEB_ORIGIN", "http://localhost:3000").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


class Alert(BaseModel):
    alert_text: str = Field(min_length=3, max_length=12000)
    recorded: bool = True
    sample_id: str | None = None


class Resolution(BaseModel):
    request_id: UUID
    incident_text: str = Field(min_length=8, max_length=24000)
    root_cause: str = Field(min_length=1, max_length=120)
    helped_ids: list[str] = Field(default_factory=list, max_length=20)
    fix_ids: list[str] = Field(default_factory=list, max_length=20)


@lru_cache
def memory(recorded):
    state_dir = Path(os.getenv("PRECEDENT_STATE_DIR") or CACHE)
    return Ledger(state_dir / ("recorded-memory.sqlite" if recorded else "live-memory.sqlite"))


@lru_cache
def live():
    if not os.getenv("HYDRADB_API_KEY") or not (OUT / "manifest.jsonl").exists():
        raise HTTPException(503, "Live retrieval needs a configured HydraDB database and an ingested incident corpus.")
    docs = read_manifest()
    encoder = Encoder()
    remote = Hydra()
    probe_path = OUT / "spikes.json"
    probes = json.loads(probe_path.read_text()) if probe_path.exists() else {}
    remote.separate = remote.separate or probes.get("S9", {}).get("status") == "fail"
    return remote, {doc.id: doc for doc in docs}, encoder, VectorIndex(docs, encoder)


def state(recorded):
    store = memory(recorded)
    if recorded:
        return store, {doc.id: doc for doc in [*corpus(), *store.documents()]}, [*initial_edges(), *store.all_edges()]
    _, docs, _, _ = live()
    return store, {**docs, **{doc.id: doc for doc in store.documents()}}, store.all_edges()


@app.get("/health")
@app.get("/api/health")
def health():
    return {"ok": True, "recorded": True, "live_configured": bool(os.getenv("HYDRADB_API_KEY") and (OUT / "manifest.jsonl").exists())}


@app.get("/api/samples")
def get_samples(recorded: bool = True):
    if recorded:
        return samples()
    mined = OUT / "samples.json"
    if not mined.exists() or not (OUT / "manifest.jsonl").exists():
        return []
    report = json.loads(mined.read_text())
    docs = {doc.id: doc for doc in read_manifest()}
    return [
        dict(id=f"hard-{current}", title=f"Hard pair · {current}", alert_text=docs[current].symptom_text,
             expected_precedent_id=earlier, note="Real GitLab symptom text from the replay corpus.")
        for _, earlier, current in report.get("pairs", []) if earlier in docs and current in docs
    ][:10]


@app.get("/api/metrics")
def metrics(recorded: bool = True):
    file = ROOT / "web/public/results.json" if recorded else OUT / "results.json"
    if not recorded and not file.exists():
        file = OUT / "baseline-results.json"
        if not file.exists():
            file = ROOT / "docs/gitlab-baseline.json"
    if not file.exists():
        raise HTTPException(404, "No replay results are available for this mode.")
    return json.loads(file.read_text())


@app.get("/api/memory")
def get_memory(recorded: bool = True):
    meter = memory(recorded).meter()
    meter["learned_edges"] += len(initial_edges()) if recorded else 0
    return meter


@app.get("/api/graph/{id_:path}")
def graph(id_: str, recorded: bool = True):
    try:
        _, docs, edges = state(recorded)
        upstream = live()[0].subgraph(id_) if not recorded and id_ in docs else None
        result = graph_view(id_, docs, edges, upstream)
        if id_ != "all" and not result["nodes"]:
            raise HTTPException(404, "Source not found.")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logging.getLogger(__name__).warning("Graph request failed: %s", type(exc).__name__)
        raise HTTPException(502, "The source graph is temporarily unavailable.") from exc


@app.post("/api/analyze")
def analyze_alert(alert: Alert):
    text = alert.alert_text.strip()
    if len(text) < 3:
        raise HTTPException(422, "Enter the symptoms from an alert.")
    try:
        store, docs, edges = state(alert.recorded)
        sample = next((s for s in samples() if s["id"] == alert.sample_id and s["alert_text"] == text), None) if alert.recorded else None
        if sample and sample.get("withheld_id") and not any(e["source"] == sample["withheld_id"] and
                                                            e["target"] == sample["expected_precedent_id"]
                                                            and e not in initial_edges() for e in edges):
            withheld = sample["withheld_id"]
            docs.pop(withheld, None)
            edges = [edge for edge in edges if withheld not in (edge["source"], edge["target"])]
        if alert.recorded:
            output = analyze(text, docs, Encoder(recorded=True), edges, sample=sample)
        else:
            remote, original, encoder, index = live()
            if len(docs) != len(original):
                index = VectorIndex(list(docs.values()), encoder)
            probe_path = OUT / "spikes.json"
            probes = json.loads(probe_path.read_text()) if probe_path.exists() else {}
            output = analyze(text, docs, encoder, edges, remote, index=index,
                             with_ledger=probes.get("S1", {}).get("status") == "fail")
        upstream_id = output.pop("upstream_request_id")
        request_id = str(uuid4())
        output["request_id"] = request_id
        if sample and sample.get("expected_precedent_id") in docs and sample.get("withheld_id"):
            prior = docs[sample["expected_precedent_id"]]
            output["resolution_candidates"] = [{"id": prior.id, "title": prior.title}]
        store.store_request(request_id, dict(output, alert_text=text, sample_id=sample["id"] if sample else None), upstream_id)
        return output
    except HTTPException:
        raise
    except Exception as exc:
        logging.getLogger(__name__).warning("Analysis failed: %s", type(exc).__name__)
        raise HTTPException(502, "Retrieval failed. Try again or switch to recorded results.") from exc


@app.post("/api/resolve")
def resolve(resolution: Resolution):
    request_id = str(resolution.request_id)
    recorded = True
    store = memory(recorded)
    request = store.request(request_id)
    if request is None:
        recorded = False
        store = memory(recorded)
        request = store.request(request_id)
    if request is None:
        raise HTTPException(404, "Analyze the alert before recording a resolution.")
    result, upstream_id = request
    allowed = {item["id"] for item in [*result["precedent"], *result.get("resolution_candidates", [])]}
    if not set(resolution.helped_ids) <= allowed:
        raise HTTPException(422, "Select helpful precedents from this analysis.")
    text, label = resolution.incident_text.strip(), resolution.root_cause.strip()
    if len(text) < 8 or not label:
        raise HTTPException(422, "Enter a resolution summary and root cause.")
    fixes = list(dict.fromkeys(x.strip() for x in resolution.fix_ids if x.strip()))
    if any(len(x) > 400 or "\n" in x for x in fixes):
        raise HTTPException(422, "Enter a source ID or a single-line fix reference.")
    sample = next((s for s in samples() if s["id"] == result["sample_id"]), {})
    id_ = sample.get("withheld_id") if recorded else None
    id_ = id_ or f"inc-{request_id}"
    doc = Document(id=id_, title=result["alert_text"].splitlines()[0][:100], full_text=text,
                   symptom_text=result["alert_text"], root_cause=label, fix_refs=fixes,
                   created_at=datetime.now(timezone.utc).isoformat())
    edges = create_edges(doc, resolution.helped_ids, fixes)
    output = dict(incident_id=id_, edges_added=edges, feedback_sent=False)
    remote = live()[0] if not recorded else None
    _, docs, _ = state(recorded)

    def upload():
        hosted = [edge for edge in edges if edge["target"] in docs]
        probe_path = OUT / "spikes.json"
        probes = json.loads(probe_path.read_text()) if probe_path.exists() else {}
        remote.ingest([doc], "learn", {doc.id: hosted}, typed=probes.get("S8", {}).get("status") == "pass")

    try:
        stored = store.record(doc, edges, output, upload if remote else None)
        if stored is output and remote:
            stored["feedback_sent"] = send_feedback(remote, feedback_ledger(), upstream_id, resolution.helped_ids, bool(resolution.helped_ids))
            with store.connect() as db:
                db.execute("UPDATE resolutions SET response=? WHERE id=?", (json.dumps(stored), id_))
        return stored
    except Exception as exc:
        logging.getLogger(__name__).warning("Resolution failed: %s", type(exc).__name__)
        raise HTTPException(502, "The resolution could not be saved. You can retry.") from exc
