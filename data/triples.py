import argparse

from baseline.vector_index import Encoder
from data.hard_pairs import mine
from data.model import OUT, read_manifest, write_json


def triples(docs, encoder):
    hard, pairs, threshold, earlier = mine(docs, encoder)
    lookup = {doc.id: doc for doc in docs}
    candidates = []
    for j, neighbors in earlier.items():
        similar = sorted(neighbors, reverse=True)[:3]
        dissimilar = sorted(neighbors)[:5]
        for js, s in similar:
            for ji, i in dissimilar:
                if lookup[i].created_at < lookup[s].created_at and ji < threshold and js > ji:
                    candidates.append((js - ji, j, s, i))
    ranked = []
    used = set()
    for score, j, s, i in sorted(candidates, reverse=True):
        if j in used:
            continue
        ranked.append(dict(separation=round(score, 4), J=j, S=s, I=i, alert_text=lookup[j].symptom_text,
                           resolution_text=lookup[s].full_text, precedent_text=lookup[i].symptom_text))
        used.add(j)
    return dict(threshold=threshold, hard_ids=sorted(hard), pairs=pairs[:20], triples=ranked[:10])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--recorded", action="store_true")
    args = parser.parse_args()
    if args.recorded:
        from data.recorded import corpus
        docs = corpus()
    else:
        from data.parse import leak_flags
        docs = [doc for doc in read_manifest() if not leak_flags(doc)]
    write_json(OUT / "samples.json", triples(docs, Encoder(recorded=args.recorded)))
