"""Translate SDK envelopes and raw response variants into ranked source IDs."""
from dataclasses import asdict, is_dataclass
import logging


def raw(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)
    if is_dataclass(value):
        return asdict(value)
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if isinstance(value, dict):
        return {key: raw(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [raw(item) for item in value]
    return value


def source_id(row):
    if isinstance(row, str):
        return row
    if not isinstance(row, dict):
        return ""
    for key in ("source_id", "context_id", "document_id", "knowledge_id", "source"):
        value = row.get(key)
        if isinstance(value, str):
            return value
        if isinstance(value, dict) and (value := source_id(value)):
            return value
    metadata = row.get("additional_metadata") or row.get("metadata") or {}
    return metadata.get("precedent_id") or row.get("id") or ""


def rows(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return list(value.values())
    return []


def normalize(response):
    envelope = raw(response)
    body = envelope.get("data") or envelope
    meta = envelope.get("meta") or body.get("meta") or {}
    chunks = body.get("chunks") or body.get("results") or body.get("sources") or []
    ids = list(dict.fromkeys(sid for row in rows(chunks) if (sid := source_id(row))))
    graph = body.get("graph_context") or {}
    paths = rows(graph.get("paths") or graph.get("relations") or (rows(graph.get("query_paths")) + rows(graph.get("chunk_relations")))) if isinstance(graph, dict) else rows(graph)
    expansions = {}
    if isinstance(chunks, list):
        for row in chunks:
            if isinstance(row, dict):
                related = row.get("forceful_relations") or row.get("related_sources") or row.get("relations") or []
                expansions.setdefault(source_id(row), []).extend(filter(None, map(source_id, rows(related))))
    chunk_ids = {row.get("chunk_uuid"): source_id(row) for row in rows(chunks) if isinstance(row, dict)}
    for row in rows(chunks):
        if isinstance(row, dict):
            expansions.setdefault(source_id(row), []).extend(
                source_id((body.get("additional_context") or {}).get(id_, id_))
                for id_ in row.get("extra_context_ids") or [])
    forceful = body.get("forceful_relations") or {}
    if isinstance(forceful, dict):
        for entry in rows(forceful.get("declared")) + rows(forceful.get("inferred")):
            via = entry.get("via") or {}
            parent = via.get("from") or via.get("from_")
            target = source_id(entry.get("chunk")) or via.get("to")
            if parent and target:
                expansions.setdefault(chunk_ids.get(parent, parent), []).append(target)
    for key in ("expansions", "related_sources"):
        extra = body.get(key)
        if isinstance(extra, dict):
            for parent, related in extra.items():
                expansions.setdefault(parent, []).extend(filter(None, map(source_id, rows(related))))
        elif isinstance(extra, list):
            for row in extra:
                if not isinstance(row, dict):
                    continue
                parent = row.get("parent_source_id") or row.get("query_source_id") or row.get("from_source_id")
                if parent:
                    expansions.setdefault(parent, []).extend(filter(None, map(source_id, rows(row.get("sources") or [row]))))
    for path in paths:
        if isinstance(path, dict):
            parent = path.get("source_id") or path.get("from_source_id")
            target = path.get("target_source_id") or path.get("related_source_id")
            if parent and target:
                expansions.setdefault(parent, []).append(target)
            connected = list(dict.fromkeys(chunk_ids[id_] for id_ in path.get("source_chunk_ids") or []
                                           if id_ in chunk_ids))
            for anchor in connected:
                expansions.setdefault(anchor, []).extend(id_ for id_ in connected if id_ != anchor)
    known = {"chunks", "results", "sources", "graph_context", "additional_context", "forceful_relations",
             "expansions", "related_sources", "request_id", "meta"}
    if unknown := body.keys() - known:
        logging.getLogger(__name__).debug("HydraDB query fields: %s", sorted(unknown))
    return dict(ids=ids, expansions=expansions, paths=paths,
                request_id=meta.get("request_id") or body.get("request_id") or envelope.get("request_id"))
