"""Walk-forward evaluation. Cache query envelopes and per-query measurements."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from time import perf_counter

from baseline.vector_index import Encoder, MODEL, REVISION, VectorIndex
from data.hard_pairs import mine
from data.model import CACHE, OUT, ROOT, read_manifest, write_json
from data.parse import leak_flags
from data.recorded import corpus
from eval.arms import retrieve
from eval.metrics import aggregate, rank, score, token_counter
from eval.stats import bootstrap, paired
from hydra.contract import Hydra, SDK_VERSION
from hydra.learn import create_edges, feedback_ledger, send_feedback

DEMO_DB = ROOT / "data/recorded-replay.sqlite"
DEMO_RESULTS = ROOT / "web/public/results.json"
BASELINE_DB = CACHE / "gitlab-baseline.sqlite"
LIVE_DB = CACHE / "replay.sqlite"
SEED = 2026


def database(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, manifest TEXT);
        CREATE TABLE IF NOT EXISTS calibration (
          run TEXT, alpha REAL, incident TEXT, query_hash TEXT, raw TEXT,
          PRIMARY KEY (run, alpha, incident));
        CREATE TABLE IF NOT EXISTS results (
          run TEXT, batch INT, arm TEXT, incident TEXT, query_hash TEXT, raw TEXT, measurement TEXT,
          PRIMARY KEY (run, batch, arm, incident));
    """)
    return db


def available_at(doc):
    return doc.closed_at or doc.created_at


def splits(docs, count):
    if len(docs) < 8:
        raise ValueError("At least eight eligible incidents are required.")
    size = len(docs)
    cuts = [0, max(1, size // 5)]
    cuts += [cuts[1] + (size - cuts[1]) * i // count for i in range(1, count + 1)]
    for i in range(1, len(cuts) - 1):
        while cuts[i] < size and docs[cuts[i] - 1].created_at == docs[cuts[i]].created_at:
            cuts[i] += 1
    boundaries = sorted(set(cuts))
    if len(boundaries) < 3:
        raise ValueError("Incidents need at least two distinct time windows.")
    return [docs[a:b] for a, b in zip(boundaries, boundaries[1:])]


def live_source(args):
    docs = read_manifest()
    eligible = [d for d in docs if d.doc_type == "incident" and d.root_cause != "unlabeled"
                and d.closed_at and d.symptom_text and not leak_flags(d)]
    return docs, eligible


def run(args):
    if not (args.recorded or args.baseline_only or os.getenv("HYDRADB_API_KEY")):
        raise SystemExit("Set HYDRADB_API_KEY before a hosted replay. For controls only, use --baseline-only.")
    docs, eligible = (corpus(9), None) if args.recorded else live_source(args)
    eligible = eligible if eligible is not None else [d for d in docs if d.doc_type == "incident"]
    variant = args.variant
    query = lambda doc: doc.symptom_text if variant == "primary" else (doc.alert_title if variant == "Q" else doc.title)
    # Query variants keep the same training history. Only test queries with a variant are scored.
    ordered = sorted(eligible, key=lambda d: (d.created_at, d.id))
    batches = splits(ordered, 8 if len(ordered) >= 300 or args.recorded else 6)
    graded = sum(bool(d.fix_refs) for d in ordered) / len(ordered) >= .3
    encoder = Encoder(recorded=args.recorded)
    tokens = token_counter(args.recorded)
    hard, _, threshold, _ = mine(ordered, encoder)
    probe_file = OUT / "spikes.json"
    probes = json.loads(probe_file.read_text()) if probe_file.exists() else {}
    typed = args.recorded or bool(probes.get("S8", {}).get("status") == "pass")
    ledger_fallback = bool(probes.get("S1", {}).get("status") == "fail") or args.ledger_fallback
    arms = ["A", "B", "C", *(["C+"] if typed else []), "D", "random", "prior"]
    run_id = args.run_id or ("synthetic-recording" if args.recorded else datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"))
    if args.baseline_only:
        arms = ["A", "random", "prior"]
    remote = None
    if not args.recorded and not args.baseline_only:
        name = os.getenv("HYDRA_REPLAY_DATABASE") or "precedent_replay"
        suffix = hashlib.sha256(run_id.encode()).hexdigest()[:12]
        remote = Hydra(database=f"{name}-{suffix}")
        remote.separate = remote.separate or probes.get("S9", {}).get("status") == "fail"
        collections = ("plain", "learn", "declared") if typed else ("plain", "learn")
        for db_name in {remote.database_for(collection) for collection in collections}:
            try:
                remote.client.databases.status(database=db_name)
            except Exception as exc:
                if getattr(exc, "status_code", None) != 404:
                    raise
            else:
                raise RuntimeError("This replay database already exists. Use a new run ID to keep the history clean.")
        remote.ensure_database(collections=collections)
    response_db = args.cache or (DEMO_DB if args.recorded else BASELINE_DB if args.baseline_only else LIVE_DB)
    manifest = dict(run_id=run_id, provenance="synthetic" if args.recorded else "gitlab-baseline" if args.baseline_only else "gitlab-live",
                    policy=args.policy, query_variant=variant, graded=graded, seed=SEED, typed=typed,
                    arms=arms, sdk=None if args.recorded else SDK_VERSION, contract=remote.contract if remote else None,
                    model="Sparse lexical fixture" if args.recorded else MODEL, token_budget=1500,
                    model_revision=None if args.recorded else REVISION,
                    database=remote.database if remote else None,
                    isolation=("database" if remote.separate else "collection") if remote else None, tokenization="lexical proxy" if args.recorded else "o200k_base",
                    hard_threshold=threshold, fallback_queries=sum(d.used_fallback for d in ordered),
                    split_boundaries=[dict(start=b[0].created_at, end=b[-1].created_at, n=len(b)) for b in batches],
                    snapshot=hashlib.sha256(json.dumps([d.json() for d in docs], sort_keys=True).encode()).hexdigest())
    live_ledger = feedback_ledger() if remote else None
    past, edges, pending = {}, [], []
    declared_ids = set()
    seed = batches[0]
    first = batches[1][0].created_at
    books = [d for d in docs if d.doc_type == "runbook" and d.created_at < first]
    pending = [(d, [], True) for d in [*seed, *books]]

    def ingest(due, plain_only=False):
        if not due:
            return
        adding = [item[0] for item in due]
        learned = {d.id: [edge for edge in links if edge["target"] in past] for d, links, _ in due}
        if remote:
            remote.ingest(adding, "plain")
            if typed:
                remote.ingest(adding, "declared", typed=not plain_only)
            remote.ingest(adding, "learn", learned, typed=typed and not plain_only)
        past.update((doc.id, doc) for doc in adding)
        if typed and not plain_only:
            declared_ids.update(doc.id for doc in adding)
        edges.extend(edge for links in learned.values() for edge in links)

    def release(boundary):
        due = [item for item in pending if available_at(item[0]) < boundary]
        pending[:] = [item for item in pending if item not in due]
        ingest([item for item in due if item[2]], plain_only=True)
        ingest([item for item in due if not item[2]])

    release(first)
    alpha = .8
    calibration = []
    # Tune using only earlier, already-resolved seed documents as candidates.
    if remote:
        seed_queries = [d for d in seed if d.id in past]
        candidates = [.5, .65, .8, .95]
        alpha_scores = {}
        for value in candidates:
            values = []
            for doc in seed_queries[-20:]:
                pool = {id_: d for id_, d in past.items() if available_at(d) < doc.created_at and d.created_at < doc.created_at}
                if not pool:
                    continue
                response = remote.query(doc.symptom_text, "B", value, ids=list(pool))
                from hydra.normalize import normalize, raw
                calibration.append((run_id, value, doc.id, hashlib.sha256(doc.symptom_text.encode()).hexdigest(), json.dumps(raw(response))))
                ranked = rank(normalize(response), pool)
                metric = score(doc, pool, ranked, graded, tokens)
                if metric["reachable"]:
                    values.append(metric["ndcg"])
            if values:
                alpha_scores[value] = sum(values) / len(values)
        if alpha_scores:
            alpha = max(alpha_scores, key=lambda a: (alpha_scores[a], -abs(a - .8)))
        manifest["alpha_calibration"] = alpha_scores
    manifest["alpha"] = alpha
    with closing(database(response_db)) as db, db:
        db.execute("DELETE FROM results WHERE run=?", (run_id,))
        db.execute("DELETE FROM calibration WHERE run=?", (run_id,))
        db.executemany("INSERT INTO calibration VALUES (?,?,?,?,?)", calibration)
        db.execute("INSERT OR REPLACE INTO runs VALUES (?,?)", (run_id, json.dumps(manifest)))
        for number, batch in enumerate(batches[1:], 1):
            release(batch[0].created_at)
            index = VectorIndex(list(past.values()), encoder)
            writeback = []
            for doc in batch:
                text = query(doc)
                for arm in arms if text else []:
                    start = perf_counter()
                    result, envelope = retrieve(arm, text, past, index, remote, edges, alpha, ledger_fallback, SEED + number, declared_ids)
                    elapsed = (perf_counter() - start) * 1000 if not args.recorded else 0
                    ranked = rank(result, past)
                    metric = score(doc, past, ranked, graded, tokens, doc.id in hard, elapsed)
                    metric.update(id=doc.id, ranked=ranked, root_cause=doc.root_cause)
                    query_hash = hashlib.sha256(text.encode()).hexdigest()
                    db.execute("INSERT INTO results VALUES (?,?,?,?,?,?,?)",
                               (run_id, number, arm, doc.id, query_hash, json.dumps(envelope or result), json.dumps(metric)))
                    if arm == "D":
                        helped = [id_ for id_ in ranked["incident"] if past[id_].root_cause == doc.root_cause]
                        relevant = list(helped)
                        if args.policy == "manual_link":
                            earlier = [d for d in past.values() if d.root_cause == doc.root_cause and d.id not in helped]
                            if earlier:
                                helped.append(max(earlier, key=lambda d: d.created_at).id)
                        writeback.append((doc, helped, relevant, result.get("request_id")))
                if not text or "D" not in arms:
                    writeback.append((doc, [], [], None))
            # No edge, feedback or document from this batch is sent before all its queries finish.
            for doc, helped, relevant, request_id in writeback:
                if remote:
                    send_feedback(remote, live_ledger, request_id, relevant, bool(relevant))
                links = create_edges(doc, helped, [ref for ref in doc.fix_refs if ref in past])
                if args.recorded:
                    for edge in links:
                        edge["confirmed_at"] = available_at(doc)
                pending.append((doc, links, False))
            db.commit()
        release("9999")
        manifest["status"] = "complete"
        manifest["counters"] = remote.counts if remote else None
        db.execute("UPDATE runs SET manifest=? WHERE id=?", (json.dumps(manifest), run_id))
    return response_db, run_id


def report(path, run_id, output):
    if not path.exists():
        raise SystemExit(f"No cached replay at {path}")
    with closing(database(path)) as db:
        if not run_id:
            row = db.execute("SELECT id FROM runs ORDER BY rowid DESC LIMIT 1").fetchone()
            if not row:
                raise SystemExit("No completed runs in the cache.")
            run_id = row[0]
        entry = db.execute("SELECT manifest FROM runs WHERE id=?", (run_id,)).fetchone()
        if not entry:
            raise SystemExit(f"No cached run named {run_id}")
        manifest = json.loads(entry[0])
        if manifest.get("status") != "complete":
            raise SystemExit(f"Run {run_id} did not finish.")
        records = [(batch, arm, json.loads(measurement)) for batch, arm, measurement in db.execute(
            "SELECT batch,arm,measurement FROM results WHERE run=? ORDER BY batch,arm,incident", (run_id,))]
    batch_ids = sorted({record[0] for record in records})
    arms = manifest["arms"]
    groups = {arm: [r for _, a, r in records if arm == a] for arm in arms}
    last = {arm: [r for b, a, r in records if arm == a and b in batch_ids[-3:]] for arm in arms}
    series = []
    for batch in batch_ids:
        values = {}
        batch_rows = {arm: [r for b, a, r in records if b == batch and a == arm] for arm in arms}
        for arm, rows in batch_rows.items():
            values[arm] = dict(aggregate(rows),
                               ci=bootstrap([r["ndcg"] for r in rows if r["reachable"]]),
                               hard_ci=bootstrap([r["ndcg"] for r in rows if r["reachable"] and r["hard"]]))
        delta = paired(batch_rows["D"], batch_rows["A"]) if "D" in batch_rows else None
        series.append(dict(batch=batch, arms=values, paired_delta=delta))
    anchor = "D" if "D" in arms else "A"
    differences = {f"D−{arm}": paired(last["D"], last[arm]) for arm in ("C+", "C", "A") if arm in last and "D" in last}
    d_plus = differences.get("D−C+")
    hard = paired(last["D"], last["A"], hard=True) if "D" in last else None
    full = paired(groups["D"], groups["A"]) if "D" in groups else None
    summary = {arm: aggregate(rows) for arm, rows in groups.items()}
    d, a = summary.get("D"), summary["A"]
    budget = None
    if d and d["budget_ndcg"] is not None and a["budget_ndcg"] is not None:
        budget = ((d["budget_ndcg"] >= a["budget_ndcg"] and d["budget_tokens"] < a["budget_tokens"])
                  or (d["budget_ndcg"] > a["budget_ndcg"] and d["budget_tokens"] <= a["budget_tokens"]))
    criteria = [
        dict(label="Learning improves reachable nDCG@5 over declared structure", met=d_plus[1] > 0 if d_plus else None),
        dict(label="Precedent improves hard-subset nDCG@5 over vector", met=hard[0] > 0 if hard else None),
        dict(label="No material quality regression versus vector", met=full[0] >= -(full[2] - full[1]) / 2 if full else None),
        dict(label="Quality holds at a lower token budget or improves at equal budget", met=budget),
    ]
    vector = {r["id"]: r for r in groups["A"]}
    examples = [dict(id=r["id"], root_cause=r["root_cause"], delta=round(r["ndcg"] - vector[r["id"]]["ndcg"], 4),
                     vector=vector[r["id"]]["ranked"], precedent=r["ranked"]) for r in groups.get("D", []) if r["id"] in vector]
    write_json(output, dict(manifest=manifest, series=series, summary=summary, differences=differences,
                            criteria=criteria, wins=sorted((e for e in examples if e["delta"] > 0), key=lambda e: -e["delta"])[:20],
                            failures=sorted((e for e in examples if e["delta"] < 0), key=lambda e: e["delta"])[:20]))
    print(f"{run_id}: {len(groups[anchor])} tests, {len(series)} batches → {output}")


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recorded", action="store_true")
    parser.add_argument("--recompute", action="store_true")
    parser.add_argument("--baseline-only", action="store_true")
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--run-id")
    parser.add_argument("--policy", choices=("assisted", "manual_link"), default="assisted")
    parser.add_argument("--variant", choices=("primary", "Q", "L"), default="primary")
    parser.add_argument("--ledger-fallback", action="store_true")
    args = parser.parse_args()
    cache, run_id = (args.cache or (DEMO_DB if args.recorded else BASELINE_DB if args.baseline_only else LIVE_DB), args.run_id) if args.recompute else run(args)
    report(cache, run_id, args.output or (DEMO_RESULTS if args.recorded else OUT / ("baseline-results.json" if args.baseline_only else "results.json")))
