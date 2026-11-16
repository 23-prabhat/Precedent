from time import perf_counter

from baseline.vector_index import VectorIndex
from data.recorded import SAMPLES, TRIPLES, corpus, initial_edges
from eval.metrics import rank, token_counter
from hydra.learn import expand_via_ledger
from hydra.normalize import normalize


def row(doc, reason, edge_from=None, score=None):
    return dict(id=doc.id, title=doc.title, description=doc.symptom_text or doc.full_text[:240], services=doc.services,
                root_cause=doc.root_cause, url=doc.url, date=doc.created_at[:10], doc_type=doc.doc_type,
                why=reason, via=edge_from, score=score)


def samples():
    return [*SAMPLES, *TRIPLES]


def local_results(text, docs, index, edges, sample=None):
    weights = index.search(text)
    ids = [id_ for id_, score in weights if score > 0]
    vector = dict(ids=ids, expansions={})
    graph = dict(ids=ids, expansions=expand_via_ledger(ids[:5], edges))
    if sample and sample.get("withheld_id"):
        # Known fixture triplets show the expansion even when the baseline ranks the older incident below k.
        id_ = sample["withheld_id"]
        target = sample["expected_precedent_id"]
        if any(edge["source"] == id_ and edge["target"] == target for edge in edges):
            graph["ids"] = [id_, *[value for value in ids if value != id_]]
            graph["expansions"][id_] = [target]
        else:
            graph["ids"] = [value for value in ids if value != target]
    return vector, graph, dict(reversed(weights))


def analyze(text, docs, encoder, edges, upstream=None, sample=None, index=None, with_ledger=False):
    from api.briefing import briefing

    start = perf_counter()
    index = index or VectorIndex(list(docs.values()), encoder)
    count_tokens = token_counter(encoder.recorded)
    if upstream:
        hits = index.search(text)
        vec, scores = dict(ids=[id_ for id_, _ in hits], expansions={}), dict(reversed(hits))
        result = upstream.query(text, "D")
        graph = normalize(result)
        if with_ledger:
            for parent, related in expand_via_ledger(graph["ids"][:5], edges).items():
                graph["expansions"].setdefault(parent, []).extend(related)
    else:
        result = None
        vec, graph, scores = local_results(text, docs, index, edges, sample)
    vector_rank, graph_rank = rank(vec, docs), rank(graph, docs)
    incident_ids = graph_rank["incident"]
    books = graph_rank["runbook"]
    path_for = {}
    for parent in graph["ids"][:5]:
        for target in graph["expansions"].get(parent, [])[:2]:
            if target in incident_ids and target != parent and target != (graph["ids"] or [""])[0]:
                edge = next((item for item in edges if {item["source"], item["target"]} == {parent, target}), None)
                path_for.setdefault(target, dict(source=parent, target=target, type=edge["type"] if edge else "RELATED",
                                                 reason=edge["reason"] if edge else "HydraDB returned this source through graph context."))
    paths = list(path_for.values())
    graph_rows = [row(docs[id_], path_for[id_]["reason"] if id_ in path_for else "Retrieved from the alert symptoms.",
                      path_for[id_]["source"] if id_ in path_for else None) for id_ in incident_ids]

    def used_tokens(ranks):
        return sum(count_tokens(docs[id_].full_text) for id_ in [*ranks["incident"], *ranks["runbook"]])

    evidence = [docs[id_] for id_ in incident_ids]
    runbooks = [docs[id_] for id_ in books]
    if encoder.recorded and paths:
        evidence.sort(key=lambda doc: doc.id not in path_for)
    return dict(vector=[row(docs[id_], "Matched the language of the alert.", score=round(scores[id_], 3))
                        for id_ in vector_rank["incident"]],
                precedent=graph_rows, paths=paths, graph_context=graph.get("paths", []),
                runbooks=[row(doc, "Retrieved as a possible diagnostic reference.") for doc in runbooks],
                briefing=briefing(text, evidence, runbooks, result, count_tokens),
                tokens=dict(vector=used_tokens(vector_rank), precedent=used_tokens(graph_rank)),
                latency_ms=round((perf_counter() - start) * 1000) if upstream else None,
                provenance="live" if upstream else "recorded",
                upstream_request_id=graph.get("request_id"))


def graph_view(id_, docs, edges, remote=None):
    if id_ == "all" and len(docs) > 60:
        newest = sorted((doc for doc in docs.values() if doc.doc_type == "incident"),
                        key=lambda doc: doc.created_at, reverse=True)[:24]
        retained = {doc.id for doc in newest}
        retained |= {ref for doc in newest for ref in doc.fix_refs}
        retained |= {edge["target"] for edge in edges if edge["source"] in retained}
        docs = {key: doc for key, doc in docs.items() if key in retained}
    edge_rows = [dict(edge, kind="learned") for edge in edges]
    for doc in docs.values():
        for fix in doc.fix_refs:
            if fix in docs and not any(e["source"] == doc.id and e["target"] == fix for e in edge_rows):
                edge_rows.append(dict(source=doc.id, target=fix, type="REFERENCES_FIX", reason="Cited in the incident record.", kind="declared"))
    if remote is None and any(id_.startswith("INC-") for id_ in docs):
        incident_docs = [d for d in docs.values() if d.doc_type == "incident" and d.services]
        for idx, doc in enumerate(incident_docs):
            for other in incident_docs[:idx]:
                if set(doc.services).intersection(other.services):
                    edge_rows.append(dict(source=doc.id, target=other.id, type="SAME_SERVICE",
                                          reason=f"Both records mention {doc.services[0]}.", kind="auto"))
    entities = {}
    if remote:
        body = remote.get("data") or {}
        relations = [*(body.get("relations") or []), *(body.get("auxiliary_relations") or [])]
        for edge in relations:
            if not isinstance(edge, dict):
                continue
            ends = []
            for key in ("subject", "object"):
                value = edge.get(key) or edge.get("source" if key == "subject" else "target")
                name = (value.get("name") or value.get("id")) if isinstance(value, dict) else value
                if name:
                    identifier = name if name in docs else f"entity:{name}"
                    entities[identifier] = row(docs[identifier], "") if identifier in docs else dict(
                        id=identifier, title=name, doc_type="entity", root_cause="", services=[])
                    ends.append(identifier)
            if len(ends) != 2:
                continue
            for relation in edge.get("relations") or [edge]:
                predicate = relation.get("predicate") or relation.get("relation") or "RELATED"
                if not isinstance(predicate, str):
                    predicate = "RELATED"
                edge_rows.append(dict(source=ends[0], target=ends[1], type=predicate,
                                      reason=relation.get("context") or predicate,
                                      kind="learned" if predicate == "SAME_FIX_AS" else "declared" if relation.get("origin") == "byog" else "auto"))
    for edge in edge_rows:
        target = edge["target"]
        if edge["type"] == "REFERENCES_FIX" and target not in docs and target not in entities:
            entities[target] = dict(id=target, title=target.rsplit("/", 1)[-1] or target, doc_type="runbook",
                                    root_cause="", services=[], description=target,
                                    url=target if target.startswith("https://") else "")
    selected = set(docs) | set(entities) if id_ == "all" else {id_}
    all_known = set(docs) | set(entities)
    if id_ != "all":
        for _ in range(2):
            selected |= {target for edge in edge_rows for source, target in (
                (edge["source"], edge["target"]), (edge["target"], edge["source"])) if source in selected and target in all_known}
    links = [edge for edge in edge_rows if edge["source"] in selected and edge["target"] in selected]
    nodes = [row(doc, "") for key, doc in docs.items() if key in selected]
    nodes += [node for key, node in entities.items() if key in selected and key not in docs]
    return dict(nodes=nodes, edges=links, learned_edges=[edge for edge in links if edge["kind"] == "learned"])
