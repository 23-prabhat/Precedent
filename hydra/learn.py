"""Outcome edges, idempotent resolution storage and feedback."""
from datetime import datetime, timezone
from functools import lru_cache
import os
from pathlib import Path
import json
import logging
import sqlite3
import time

from data.model import CACHE

LIMIT = 5


def create_edges(incident, helped_ids, fix_ids):
    stamp = datetime.now(timezone.utc).isoformat()
    output, seen = [], {incident.id}
    for targets, kind, reason in (
        (helped_ids, "SAME_FIX_AS", f"Responder confirmed this precedent helped resolve {incident.id}."),
        (fix_ids, "REFERENCES_FIX", f"Resolution of {incident.id} references this fix."),
    ):
        for target in targets:
            if target not in seen:
                output.append(dict(source=incident.id, target=target, type=kind, reason=reason, confirmed_at=stamp))
                seen.add(target)
    return output[:LIMIT]


class Ledger:
    def __init__(self, path=CACHE / "memory.sqlite"):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS edges (
                  source TEXT, target TEXT, kind TEXT, reason TEXT, stamp TEXT,
                  PRIMARY KEY(source,target,kind));
                CREATE TABLE IF NOT EXISTS resolutions (
                  id TEXT PRIMARY KEY, doc TEXT NOT NULL, response TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS requests (
                  id TEXT PRIMARY KEY, payload TEXT NOT NULL, upstream TEXT);
                CREATE TABLE IF NOT EXISTS feedback (stamp REAL);
            """)

    def connect(self):
        from contextlib import closing, contextmanager

        @contextmanager
        def connection():
            with closing(sqlite3.connect(self.path, timeout=60)) as db, db:
                yield db
        return connection()

    def store_request(self, id_, payload, upstream):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO requests VALUES (?,?,?)", (id_, json.dumps(payload), upstream))

    def request(self, id_):
        with self.connect() as db:
            row = db.execute("SELECT payload, upstream FROM requests WHERE id=?", (id_,)).fetchone()
        return (json.loads(row[0]), row[1]) if row else None

    def all_edges(self):
        with self.connect() as db:
            return [dict(zip(("source", "target", "type", "reason", "confirmed_at"), row))
                    for row in db.execute("SELECT * FROM edges ORDER BY stamp,source,target")]

    def documents(self):
        from data.model import Document
        with self.connect() as db:
            return [Document(**json.loads(row[0])) for row in db.execute("SELECT doc FROM resolutions ORDER BY id")]

    def record(self, doc, edges, response, before_commit=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if row := db.execute("SELECT response FROM resolutions WHERE id=?", (doc.id,)).fetchone():
                return json.loads(row[0])
            if before_commit:
                before_commit()
            db.executemany("INSERT OR IGNORE INTO edges VALUES (?,?,?,?,?)",
                           [(e["source"], e["target"], e["type"], e["reason"], e["confirmed_at"]) for e in edges])
            db.execute("INSERT INTO resolutions VALUES (?,?,?)", (doc.id, json.dumps(doc.json()), json.dumps(response)))
        return response

    def allow_feedback(self):
        now = time.time()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM feedback WHERE stamp < ?", (now - 60,))
            if db.execute("SELECT count(*) FROM feedback").fetchone()[0] >= 90:
                return False
            db.execute("INSERT INTO feedback VALUES (?)", (now,))
        return True

    def meter(self):
        with self.connect() as db:
            count = db.execute("SELECT count(*) FROM edges").fetchone()[0]
            recent = [json.loads(row[0]) for row in db.execute("SELECT response FROM resolutions ORDER BY rowid DESC LIMIT 20")]
        return dict(learned_edges=count, rolling_hit_rate=(sum(any(e["type"] == "SAME_FIX_AS" for e in r["edges_added"])
                                                                for r in recent) / len(recent)) if recent else None)


def expand_via_ledger(top_ids, edges):
    expansions = {id_: [] for id_ in top_ids}
    for edge in edges:
        source, target = edge["source"], edge["target"]
        if source in expansions:
            expansions[source].append(target)
        if target in expansions:
            expansions[target].append(source)
    return expansions


@lru_cache
def feedback_ledger():
    directory = Path(os.getenv("PRECEDENT_STATE_DIR") or CACHE)
    return Ledger(directory / "feedback.sqlite")


def send_feedback(hydra, ledger, request_id, relevant_ids, helped):
    if not hydra or not request_id:
        return False
    try:
        if not ledger.allow_feedback():
            return False
        options = dict(ground_truth={"source_ids": relevant_ids}) if relevant_ids else {}
        hydra.client.feedback.submit(database=hydra.database_for("learn"), collection="learn", request_id=request_id,
                                     source="agent", rating="positive" if helped else "neutral", **options)
        hydra.counts["feedback"] += 1
        return True
    except Exception:
        logging.getLogger(__name__).info("HydraDB feedback was unavailable.")
        return False
