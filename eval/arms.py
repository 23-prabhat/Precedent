from collections import Counter
from random import Random

from hydra.learn import expand_via_ledger
from hydra.normalize import normalize, raw


def retrieve(arm, text, past, index, remote, edges, alpha, ledger_fallback, random_seed, declared_ids):
    if arm == "random":
        ids = sorted(past)
        Random(f"{random_seed}:{text}").shuffle(ids)
        return dict(ids=ids[:15], expansions={}), None
    if arm == "prior":
        counts = Counter(d.root_cause for d in past.values() if d.doc_type == "incident")
        ids = sorted(past, key=lambda id_: (counts[past[id_].root_cause], past[id_].created_at, id_), reverse=True)
        return dict(ids=ids[:15], expansions={}), None
    if remote and arm != "A":
        response = remote.query(text, arm, alpha)
        result = normalize(response)
        if ledger_fallback and arm == "D":
            for parent, related in expand_via_ledger(result["ids"][:5], edges).items():
                result["expansions"].setdefault(parent, []).extend(related)
        return result, raw(response)
    hits = index.search(text)
    ids = [id_ for id_, _ in hits]
    expansions = {}
    if arm in {"C", "C+", "D"}:
        for parent in ids[:5]:
            doc = past[parent]
            related = [id_ for id_ in ids if id_ != parent
                       and (set(past[id_].services).intersection(doc.services) or
                            (arm in {"C+", "D"} and parent in declared_ids and id_ in declared_ids
                             and doc.root_cause != "unlabeled" and doc.root_cause == past[id_].root_cause))]
            expansions[parent] = related
    if arm == "D":
        for parent, related in expand_via_ledger(ids[:5], edges).items():
            expansions[parent] = related + expansions.get(parent, [])
    return dict(ids=ids, expansions=expansions), dict(hits=hits)
