import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from api.briefing import validate
from api.main import app
from data.model import Document
from data.parse import parse_many, scrub
from data.recorded import TRIPLES
from eval.metrics import grade, rank
from eval.replay import splits
from hydra.learn import Ledger
from hydra.normalize import normalize


class DataTests(unittest.TestCase):
    def test_query_uses_symptoms_only(self):
        impact = "Requests to the public endpoint frequently returned server errors across several regions while other requests completed after repeated attempts by callers."
        body = "## Customer Impact\n<!-- Add impact details for the reviewer. -->\n" + impact + "\n\n## References and helpful links\nhttps://gitlab.com/gitlab-com/runbooks/-/blob/master/docs/revert.md\n\n## Next steps\nIncident Review: #100"
        rows = [dict(iid=50, title="Configuration change caused the outage", labels=["RootCause::Config-Change", "Service::API"],
                     created_at="2024-01-01", description=body)]
        (doc,), _ = parse_many(rows, lambda _: dict(description="Review notes cite #999."))
        self.assertEqual(doc.symptom_text, impact + "\nAffected services: API")
        self.assertNotIn("Configuration change", doc.symptom_text)
        self.assertNotIn("#999", doc.review_text)
        self.assertNotIn("revert.md", doc.full_text)
        self.assertEqual(doc.review_id, "100")

    def test_template_comments_do_not_make_a_short_query_eligible(self):
        template = "<!-- Write a full account with at least twenty words so responders and executives can understand whether the incident affected a customer. -->"
        body = "## Customer Impact\n" + template + "\nNone."
        row = dict(iid=10, title="An incident", labels=["RootCause::Capacity"], created_at="2024-01-01", description=body)
        (doc,), _ = parse_many([row])
        self.assertEqual(doc.symptom_text, "")

    def test_scrub_only_same_tracker(self):
        text = "See #88, #99, gitlab-com/gl-infra/production#100 and other/project#123."
        self.assertEqual(scrub(text, 88), "See #88, [reference removed], [reference removed] and other/project#123.")

    def test_splits_keep_simultaneous_incidents_together(self):
        docs = [Document(str(i), "title", "", created_at=str(i // 2)) for i in range(20)]
        batches = splits(docs, 6)
        self.assertEqual([d for b in batches for d in b], docs)
        for left, right in zip(batches, batches[1:]):
            self.assertLess(left[-1].created_at, right[0].created_at)


class RetrievalTests(unittest.TestCase):
    def test_sdk_forceful_bucket_and_source_order(self):
        payload = {"meta": {"request_id": "request"},
                   "data": {"chunks": [{"id": "a", "chunk_uuid": "a-1"}, {"id": "a", "chunk_uuid": "a-2"}, {"id": "b"}],
                            "forceful_relations": {"declared": [{"via": {"from": "a-1", "to": "c"}, "chunk": {"id": "c"}}]},
                            "graph_context": {"query_paths": [{"summary": "a is connected to c"}]}}}
        result = normalize(payload)
        self.assertEqual(result["ids"], ["a", "b"])
        self.assertEqual(result["expansions"]["a"], ["c"])
        self.assertEqual(result["request_id"], "request")
        docs = {key: Document(key, key, "") for key in "abc"}
        self.assertEqual(rank(result, docs)["incident"], ["a", "c", "b"])
        self.assertTrue(result["paths"])

    def test_rank_caps_per_parent_before_partition(self):
        docs = {key: Document(key, key, "", doc_type="runbook" if key == "b" else "incident") for key in "abcde"}
        result = dict(ids=["a", "a", "e"], expansions={"a": ["b", "c", "d"]})
        self.assertEqual(rank(result, docs), {"incident": ["a", "c", "e"], "runbook": ["b"]})

    def test_grade_requires_same_cause_and_non_boilerplate_fix(self):
        a = Document("a", "a", "", root_cause="cause", fix_refs=["rb"])
        b = Document("b", "b", "", root_cause="cause", fix_refs=["rb"])
        self.assertEqual(grade(a, b, True), 2)
        self.assertEqual(grade(a, b, False), 1)

    def test_briefing_drops_unknown_ids(self):
        data = dict(abstain=False, precedents=[{"id": "missing"}], suggested_runbooks=[{"id": "missing"}],
                    likely_root_cause_classes=[{"label": "Config", "evidence_ids": ["missing"]}], check_first=["Look at missing"])
        output = validate(data, {"inc-42"}, {"rb-42"})
        self.assertTrue(output["abstain"])
        self.assertEqual(output["check_first"], [])


class DemoWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        stores = {True: Ledger(root / "demo.sqlite"), False: Ledger(root / "live.sqlite")}
        mocked = patch("api.main.memory", side_effect=stores.__getitem__)
        mocked.start()
        self.addCleanup(mocked.stop)
        self.client = TestClient(app)

    def test_three_triples_resolve_and_expand(self):
        for sample in TRIPLES:
            query = {"alert_text": sample["alert_text"], "sample_id": sample["id"]}
            before = self.client.post("/api/analyze", json=query)
            self.assertEqual(before.status_code, 200, before.text)
            result = before.json()
            ids = [x["id"] for x in result["precedent"]]
            self.assertNotIn(sample["withheld_id"], ids)
            self.assertNotIn(sample["expected_precedent_id"], ids)
            body = dict(request_id=result["request_id"], incident_text=sample["resolution_text"],
                        root_cause=sample["root_cause"], helped_ids=[sample["expected_precedent_id"]], fix_ids=[])
            resolved = self.client.post("/api/resolve", json=body)
            self.assertEqual(resolved.status_code, 200, resolved.text)
            self.assertEqual(resolved.json(), self.client.post("/api/resolve", json=body).json())
            after = self.client.post("/api/analyze", json=query).json()
            self.assertEqual(after["precedent"][0]["id"], sample["withheld_id"])
            self.assertEqual(after["precedent"][1]["id"], sample["expected_precedent_id"])
            graph = self.client.get("/api/graph/" + sample["withheld_id"]).json()
            self.assertTrue(any(edge["target"] == sample["expected_precedent_id"] for edge in graph["learned_edges"]))

    def test_live_unavailable_and_invalid_precedent(self):
        response = self.client.post("/api/analyze", json={"alert_text": "HTTP 503", "recorded": False})
        self.assertEqual(response.status_code, 503)
        request = self.client.post("/api/analyze", json={"alert_text": "HTTP 503"}).json()
        response = self.client.post("/api/resolve", json=dict(request_id=request["request_id"], incident_text="Resolved alert",
                                    root_cause="Config change", helped_ids=["unknown"]))
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
