"""Refresh the bundled Console, graph and three before/after recordings."""
from api.service import analyze, samples, graph_view
from baseline.vector_index import Encoder
from data.model import ROOT, write_json
from data.recorded import corpus, initial_edges, TRIPLES
from hydra.learn import create_edges


def build_demo():
    docs = {doc.id: doc for doc in corpus()}
    edges = initial_edges()
    recorded = {}
    encoder = Encoder(True)
    for sample in samples():
        if sample not in TRIPLES:
            recorded[sample["id"]] = analyze(sample["alert_text"], docs, encoder, edges)
    triples = {}
    for sample in TRIPLES:
        id_ = sample["withheld_id"]
        subset = {key: doc for key, doc in docs.items() if key != id_}
        original = [edge for edge in edges if id_ not in (edge["source"], edge["target"])]
        new = create_edges(docs[id_], [sample["expected_precedent_id"]], [])
        new[0]["confirmed_at"] = "2024-01-10T00:00:00+00:00"
        triples[sample["id"]] = dict(
            before=analyze(sample["alert_text"], subset, encoder, original, sample=sample),
            after=analyze(sample["alert_text"], docs, encoder, original + new, sample=sample),
            edge=new[0],
        )
    write_json(ROOT / "web/public/demo.json", dict(samples=samples(), analysis=recorded[samples()[0]["id"]],
               recordings=recorded, graph=graph_view("all", docs, edges),
               meter=dict(learned_edges=len(edges), rolling_hit_rate=None), triples=triples))


if __name__ == "__main__":
    build_demo()
