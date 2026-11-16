from itertools import chain
from functools import lru_cache
from math import log2
import re
from statistics import mean

BUDGET = 1500


def rank(result, docs, k=5):
    original = list(dict.fromkeys(id_ for id_ in result["ids"] if id_ in docs))
    seen = set()
    ranked = []
    for index, parent in enumerate(original):
        if parent in seen:
            continue
        ranked.append(parent)
        seen.add(parent)
        if index >= 5:
            continue
        count = 0
        for id_ in result["expansions"].get(parent, []):
            if id_ in docs and id_ not in seen:
                ranked.append(id_)
                seen.add(id_)
                count += 1
                if count == 2:
                    break
    return {kind: [id_ for id_ in ranked if docs[id_].doc_type == kind][:k] for kind in ("incident", "runbook")}


def grade(test, doc, graded):
    if test.root_cause == "unlabeled" or doc.root_cause != test.root_cause:
        return 0
    return 2 if graded and set(test.fix_refs).intersection(doc.fix_refs) else 1


def dcg(grades):
    return sum((2 ** value - 1) / log2(i + 2) for i, value in enumerate(grades))


def token_counter(recorded=False):
    if recorded:
        return lru_cache(maxsize=8192)(lambda s: len(re.findall(r"\w+|[^\w\s]", s)))
    import tiktoken
    tokenizer = tiktoken.get_encoding("o200k_base")
    return lru_cache(maxsize=8192)(lambda s: len(tokenizer.encode_ordinary(s)))


def score(test, past, ranked, graded, tokens, hard=False, latency=0):
    incidents, books = ranked["incident"], ranked["runbook"]
    ideal = dcg(sorted((grade(test, d, graded) for d in past.values()), reverse=True)[:5])
    grades = [grade(test, past[id_], graded) for id_ in incidents]
    cross = any(g and past[id_].services and test.services and not set(test.services).intersection(past[id_].services)
                for id_, g in zip(incidents, grades))
    budget, context = [], []
    for id_ in chain(incidents, books):
        size = tokens(past[id_].full_text)
        if sum(context) + size <= BUDGET and id_ in incidents:
            budget.append(grade(test, past[id_], graded))
        context.append(size)
    return dict(ndcg=dcg(grades) / ideal if ideal else 0, reachable=bool(ideal), ceiling=1 if ideal else 0,
                hard=hard, cross_hit=float(cross), fix_recall=(len(set(books).intersection(test.fix_refs)) / len(test.fix_refs))
                if graded and test.fix_refs else None, tokens=sum(context), budget_tokens=min(sum(context), BUDGET),
                budget_ndcg=dcg(budget) / ideal if ideal else 0, latency_ms=latency)


def aggregate(rows):
    reachable = [r for r in rows if r["reachable"]]
    hard = [r for r in reachable if r["hard"]]

    def avg(key, group):
        values = [r[key] for r in group if r[key] is not None]
        return round(mean(values), 5) if values else None

    latencies = sorted(r["latency_ms"] for r in rows)
    return dict(n=len(rows), reachable_n=len(reachable), reachable=avg("reachable", rows), ceiling=avg("ceiling", rows),
                reachable_ceiling=avg("ceiling", reachable), ndcg=avg("ndcg", reachable),
                all_ndcg=avg("ndcg", rows), hard_n=len(hard), hard_ndcg=avg("ndcg", hard),
                cross_hit=avg("cross_hit", rows), reachable_cross_hit=avg("cross_hit", reachable),
                fix_recall=avg("fix_recall", rows), reachable_fix_recall=avg("fix_recall", reachable),
                tokens=avg("tokens", rows), reachable_tokens=avg("tokens", reachable),
                budget_tokens=avg("budget_tokens", rows), budget_ndcg=avg("budget_ndcg", reachable),
                p50=round(latencies[round((len(latencies) - 1) * .5)], 2) if latencies else None,
                p95=round(latencies[round((len(latencies) - 1) * .95)], 2) if latencies else None)
