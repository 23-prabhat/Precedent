from collections import defaultdict

from baseline.vector_index import cosine


def mine(docs, encoder):
    docs = sorted((d for d in docs if d.root_cause != "unlabeled" and d.symptom_text),
                  key=lambda d: (d.created_at, d.id))
    vectors = dict(zip((d.id for d in docs), encoder.encode([d.symptom_text for d in docs]))) if docs else {}
    groups = defaultdict(list)
    pairs = []
    earlier = defaultdict(list)
    best = {}
    for doc in docs:
        group = groups[doc.root_cause]
        for past in group:
            if past.created_at >= doc.created_at:
                continue
            similarity = cosine(vectors[doc.id], vectors[past.id])
            pairs.append((similarity, past.id, doc.id))
            earlier[doc.id].append((similarity, past.id))
        if earlier[doc.id]:
            best[doc.id] = max(score for score, _ in earlier[doc.id])
        group.append(doc)
    ordered = sorted(pairs)
    threshold = ordered[int((len(ordered) - 1) * .25)][0] if ordered else 0
    return {id_ for id_, score in best.items() if score < threshold}, ordered, threshold, earlier
