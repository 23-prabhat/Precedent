"""S0–S9 probes. Use a dedicated scratch database; capture evidence and raw shapes."""
import argparse
from importlib.metadata import version
import json
import os
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from data.model import CACHE, OUT, Document, write_json
from hydra.contract import Hydra
from hydra.learn import create_edges
from hydra.normalize import normalize, raw


def spike_suite(path):
    report = {}
    coverage = CACHE / "gitlab-coverage-2023.txt"
    if not coverage.exists():
        coverage = CACHE / "gitlab-coverage.txt"
    if coverage.exists() and coverage.stat().st_size:
        data = json.loads(coverage.read_text())
        report["S4"] = dict(status="pass" if data["eligible"] >= 300 else "fail", evidence={k: data[k] for k in (
            "total", "labeled", "eligible", "per_year", "reviews", "labeled_fix_refs", "alert_titles")})
    else:
        report["S4"] = dict(status="blocked", evidence="Run the public GitLab coverage scrape.")
    prepared = OUT / "coverage.json"
    if prepared.exists():
        coverage = json.loads(prepared.read_text())
        report["S4"]["followup"] = {k: coverage[k] for k in ("total", "labeled", "eligible", "reviews", "runbooks_commit")
                                     if k in coverage}
        report["S4"]["followup_status"] = "pass" if coverage["eligible"] >= 300 else "fail"
    sdk = version("hydradb-sdk")
    if not os.getenv("HYDRADB_API_KEY"):
        for num in (0, 1, 2, 3, 5, 6, 7, 8, 9):
            report[f"S{num}"] = dict(status="blocked", evidence=f"HYDRADB_API_KEY missing. Installed SDK {sdk}.")
        write_json(path, report)
        return report

    def check(key, action):
        try:
            passed, evidence = action()
            report[key] = dict(status="pass" if passed else "fail", evidence=evidence)
        except Exception as exc:
            report[key] = dict(status="fail", evidence=str(exc))
        write_json(path, report)

    run = uuid4().hex[:8]
    hydr = Hydra(f"precedent-spike-{run}", contract="legacy", separate=False)
    a = Document("spike-a", "Quartz allocator problem", "Quartz allocator telemetry drops out across the western cells.", root_cause="Config-Change")
    b = Document("spike-b", "Pearl timeout fix", "Pearl relays stopped timing out after restoring the previous settings.", root_cause="Config-Change")
    c = Document("spike-c", "Jade response", "Jade router cannot connect to upstream listeners.", root_cause="Dependency")
    links = {b.id: create_edges(b, [a.id], [])}
    responses = {}
    started = perf_counter()

    def contract():
        hydr.ensure_database()
        try:
            hydr.ingest([a], "learn")
        except Exception as legacy_error:
            if getattr(legacy_error, "status_code", getattr(getattr(legacy_error, "response", None), "status_code", None)) != 400:
                raise
            hydr.contract = "unified"
            hydr.ingest([a], "learn")
            return True, dict(contract=hydr.contract, sdk=sdk, legacy_error=str(legacy_error), quotas="Account limits not returned")
        return True, dict(contract=hydr.contract, sdk=sdk, database=hydr.database, quotas="Account limits not returned")

    check("S0", contract)
    if not _passed(report, "S0"):
        for num in (1, 2, 3, 5, 6, 7, 8, 9):
            report[f"S{num}"] = dict(status="blocked", evidence="S0 failed.")
        write_json(path, report)
        return report
    hydr.ingest([a], "plain")
    hydr.ingest([b], "learn", links)
    hydr.ingest([c], "learn")

    def relation():
        for arm, doc in (("A-to-B", a), ("B-to-A", b)):
            response = hydr.query(doc.full_text, "D")
            responses[arm] = raw(response)
        forward = normalize(responses["A-to-B"])
        reverse = normalize(responses["B-to-A"])
        seen = lambda result, target: target in {id_ for ids in result["expansions"].values() for id_ in ids}
        return seen(forward, b.id) and seen(reverse, a.id), dict(forward=forward["expansions"], reverse=reverse["expansions"])

    check("S1", relation)

    def shape():
        for arm in ("B", "C", "D"):
            responses[arm] = raw(hydr.query(a.full_text, arm))
        destination = CACHE / f"spike-{run}-envelopes.json"
        write_json(destination, responses)
        payload = responses["D"].get("data") or {}
        return bool(normalize(responses["D"])["ids"]), dict(path=str(destination), data_fields=sorted(payload),
                                                           relation_fields=sorted(payload.get("forceful_relations") or {}))

    check("S2", shape)

    def speed():
        docs = [Document(f"bulk-{i}", f"Bulk probe {i}", f"An indexed scratch document for batch probe {i}.") for i in range(100)]
        start = perf_counter()
        fallback = None
        try:
            hydr.ingest(docs, "bulk", batch_size=100)
        except Exception as exc:
            fallback = str(exc)
            hydr.ingest(docs, "bulk-fallback", batch_size=25)
        return fallback is None, dict(seconds=round(perf_counter() - start, 2), items=100,
                                      accepted_batch_size=100 if fallback is None else 25, rejection=fallback)

    check("S3", speed)

    def paths():
        prompts = (a.full_text, b.full_text, c.full_text, "western cells telemetry", "relay timeout")
        found = sum(bool(normalize(hydr.query(prompts[i % len(prompts)], "D"))["paths"]) for i in range(20))
        return found >= 10, dict(nonempty=found, queries=20, extraction_steering="Unavailable in installed ingest signature")

    check("S5", paths)

    def filters():
        ids = normalize(hydr.query("Quartz allocator, Pearl relay or Jade router", "D", filters={"root_cause": "Config-Change"}))["ids"]
        return bool(ids) and set(ids) <= {a.id, b.id}, ids

    check("S6", filters)

    def typed():
        hydr.ingest([a], "declared", typed=True)
        envelope = raw(hydr.query(a.full_text + " Config-Change root cause", "C+"))
        responses["C+"] = envelope
        destination = CACHE / f"spike-{run}-byog.json"
        write_json(destination, envelope)
        return "HAS_ROOT_CAUSE" in json.dumps((envelope.get("data") or {}).get("graph_context")), dict(raw=str(destination))

    check("S8", typed)

    def latency():
        summary = {}
        for arm in ("B", "C", "D", *(["C+"] if _passed(report, "S8") else [])):
            values = []
            for i in range(100):
                start = perf_counter()
                hydr.query([a, b, c][i % 3].full_text, arm)
                values.append((perf_counter() - start) * 1000)
            values.sort()
            summary[arm] = dict(n=len(values), p50_ms=round(values[49], 2), p95_ms=round(values[94], 2))
        return all(row["p95_ms"] < 10000 for row in summary.values()), summary

    def isolation():
        ids = normalize(hydr.query(b.full_text, "B"))["ids"]
        return bool(ids) and b.id not in ids, dict(learning_document=b.id, plain_ids=ids)

    check("S9", isolation)
    check("S7", latency)
    report["scratch"] = dict(database=hydr.database, duration_seconds=round(perf_counter() - started, 2), counters=hydr.counts)
    write_json(path, report)
    return report


def _passed(report, key):
    return report.get(key, {}).get("status") == "pass"


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUT / "spikes.json")
    args = parser.parse_args()
    for key, value in sorted(spike_suite(args.output).items()):
        print(key, json.dumps(value))
