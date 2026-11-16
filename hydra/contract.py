"""The hosted HydraDB contract boundary."""
import io
import json
import os
import time

from hydra.normalize import raw

COLLECTION = {"B": "plain", "C": "plain", "C+": "declared", "D": "learn"}
SDK_VERSION = "2.1.7"


def metadata(doc):
    return dict(doc_type=doc.doc_type, service=(doc.services or [""])[0], root_cause=doc.root_cause,
                severity=doc.severity, year=doc.created_at[:4])


def declared_graph(doc, edges=()):
    kind = "INCIDENT" if doc.doc_type == "incident" else "RUNBOOK"
    entities = {"source": {"name": doc.id, "type": kind, "namespace": "precedent"}}
    relations = []

    def add(value, entity_type, predicate, context):
        key = f"node{len(entities)}"
        entities[key] = {"name": value, "type": entity_type, "namespace": "precedent"}
        relations.append(dict(source="source", target=key, predicate=predicate, context=context))

    if doc.root_cause != "unlabeled":
        add(doc.root_cause, "ROOT_CAUSE", "HAS_ROOT_CAUSE", f"{doc.id} was classified as {doc.root_cause}.")
    for service in doc.services:
        add(service, "SERVICE", "AFFECTS_SERVICE", f"{doc.id} concerns {service}.")
    for fix in doc.fix_refs:
        add(fix, "RUNBOOK" if fix.startswith("rb-") else "FIX", "REFERENCES_FIX", f"{doc.id} references {fix}.")
    if doc.review_id:
        add(doc.review_id, "REVIEW", "HAS_REVIEW", f"{doc.id} has incident review {doc.review_id}.")
    for edge in edges:
        if edge["type"] == "SAME_FIX_AS":
            add(edge["target"], "INCIDENT", "SAME_FIX_AS", edge["reason"])
    return {"entities": entities, "relations": relations}


class Hydra:
    def __init__(self, database=None, contract=None, separate=None):
        from hydra_db import HydraDB

        self.key = os.getenv("HYDRADB_API_KEY", "")
        if not self.key:
            raise RuntimeError("HYDRADB_API_KEY is required for hosted operations.")
        self.database = database or os.getenv("HYDRA_DATABASE", "precedent_gitlab")
        self.contract = contract or os.getenv("HYDRA_CONTRACT", "legacy")
        if self.contract not in ("legacy", "unified"):
            raise ValueError("HYDRA_CONTRACT must be legacy or unified.")
        self.separate = os.getenv("HYDRA_SEPARATE_DATABASES") == "1" if separate is None else separate
        options = {"base_url": os.environ["HYDRADB_BASE_URL"]} if os.getenv("HYDRADB_BASE_URL") else {}
        self.client = HydraDB(token=self.key, timeout=30, **options)
        self.counts = dict(ingested=0, queries=0, feedback=0)

    def database_for(self, collection):
        return f"{self.database}-{collection}" if self.separate else self.database

    def ensure_database(self, create=True, collections=("plain", "learn")):
        for name in dict.fromkeys(self.database_for(collection) for collection in collections):
            self.ensure_one(name, create)

    def ensure_one(self, name, create):
        fields = [dict(name=name, data_type="VARCHAR", max_length=256,
                       enable_dense_embedding=False, enable_sparse_embedding=False)
                  for name in ("doc_type", "service", "root_cause", "severity", "year")]
        try:
            self.client.databases.status(database=name)
        except Exception as exc:
            if not create or getattr(exc, "status_code", None) != 404:
                raise
            self.client.databases.create(database=name, database_metadata_schema=fields)
        for _ in range(90):
            body = raw(self.client.databases.status(database=name))["data"]
            if (body.get("infra") or {}).get("ready_for_ingestion"):
                return
            time.sleep(3)
        raise TimeoutError("HydraDB database did not become ready.")

    def ingest(self, docs, collection, edges=None, typed=False, batch_size=25):
        edges = edges or {}
        for index in range(0, len(docs), batch_size):
            batch = docs[index:index + batch_size]
            graph = {doc.id: declared_graph(doc, edges.get(doc.id, ())) for doc in batch} if typed else {}
            graph = {id_: item for id_, item in graph.items() if item["relations"]}
            files, items = [], []
            for doc in batch:
                more = dict(precedent_id=doc.id, url=doc.url, created_at=doc.created_at, services=doc.services)
                item = dict(id=doc.id, metadata=metadata(doc), additional_metadata=more)
                links = edges.get(doc.id, ())
                if links:
                    item["relations"] = dict(ids=[edge["target"] for edge in links],
                                             properties=dict(reason=" | ".join(edge["reason"] for edge in links),
                                                             confirmed_at=links[0]["confirmed_at"]))
                files.append((f"{doc.id}.md", io.BytesIO(doc.full_text.encode()), "text/markdown"))
                items.append(item)
            if self.contract == "legacy":
                options = dict(graph_payload=json.dumps(graph)) if graph else {}
                response = raw(self.client.context.ingest(database=self.database_for(collection), collection=collection,
                               type="knowledge", documents=files, document_metadata=json.dumps(items), **options))
            else:
                response = self.unified_ingest(batch, items, collection, graph)
            body = response.get("data") or {}
            results = body.get("results") or []
            if body.get("failed_count") or len(results) != len(batch):
                raise RuntimeError(f"HydraDB rejected ingest batch: {body}")
            for row in results:
                if row.get("status") in {"failed", "errored", "rejected"} or row.get("error") or row.get("relations_error"):
                    raise RuntimeError(f"HydraDB rejected item: {row}")
            ids = [row["id"] for row in results]
            if set(ids) != {doc.id for doc in batch}:
                raise RuntimeError("HydraDB returned different source IDs from the requested IDs.")
            self.wait(ids, collection)
            self.counts["ingested"] += len(batch)

    def unified_ingest(self, docs, items, collection, graph):
        # The installed SDK exposes the multipart contract. Verify this serializer with S0.
        import httpx

        base = os.getenv("HYDRADB_BASE_URL", "https://api.hydradb.com").rstrip("/")
        contents = []
        for doc, item in zip(docs, items):
            item = dict(item)
            relation = item.pop("relations", None)
            if relation:
                item["forceful_relations"] = dict(context_ids=relation["ids"], properties=relation["properties"])
            contents.append(dict(item, text=doc.full_text, title=doc.title))
        payload = dict(database=self.database_for(collection), collection=collection, context=contents)
        if graph:
            payload["graph_payload"] = graph
        response = httpx.post(base + "/context/ingest", json=payload,
                              headers={"Authorization": f"Bearer {self.key}", "API-Version": "2"}, timeout=30)
        response.raise_for_status()
        return response.json()

    def wait(self, ids, collection):
        if not ids:
            return
        for _ in range(120):
            data = raw(self.client.context.status(database=self.database_for(collection), collection=collection, ids=ids))["data"]
            states = {row["id"]: row for row in data.get("statuses") or []}
            for id_, row in states.items():
                if row.get("indexing_status") in {"failed", "errored", "error"}:
                    raise RuntimeError(f"HydraDB indexing failed for {id_}: {row.get('error_message')}")
            if all(states.get(id_, {}).get("indexing_status") == "completed" for id_ in ids):
                return
            time.sleep(3)
        raise TimeoutError(f"Indexing timed out in {collection}.")

    def query(self, text, arm, alpha=.8, filters=None, ids=None):
        options = dict(database=self.database_for(COLLECTION[arm]), collection=COLLECTION[arm], query=text, type="knowledge",
                       query_by="hybrid", mode="fast" if arm == "B" else "thinking",
                       graph_context=arm != "B", query_forceful_relations=arm != "B",
                       max_results=15, recency_bias=0, num_related_chunks=0, alpha=alpha)
        if filters:
            options["attributes"] = filters
        if ids is not None:
            options["ids"] = ids
        response = self.client.query(**options)
        self.counts["queries"] += 1
        return response

    def subgraph(self, id_):
        return raw(self.client.context.subgraph(database=self.database_for("learn"), collection="learn", id=id_,
                                              type="knowledge", depth=2, max_sources=20))
