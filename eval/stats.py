from random import Random
from statistics import mean


def bootstrap(values, seed=2026, repetitions=1500):
    if not values:
        return None
    rng = Random(seed)
    samples = sorted(mean(rng.choices(values, k=len(values))) for _ in range(repetitions))
    return [round(mean(values), 5), round(samples[int(.025 * repetitions)], 5),
            round(samples[int(.975 * repetitions)], 5)]


def paired(left, right, key="ndcg", hard=False):
    left = {r["id"]: r for r in left if r["reachable"] and (not hard or r["hard"])}
    right = {r["id"]: r for r in right if r["reachable"] and (not hard or r["hard"])}
    ids = sorted(left.keys() & right.keys())
    return bootstrap([left[id_][key] - right[id_][key] for id_ in ids])
