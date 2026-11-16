"""Normalize GitLab incident templates before writing an ingestion corpus."""
import argparse
from collections import Counter, defaultdict
import csv
import json
import re
from urllib.parse import parse_qs, urlsplit, urlunsplit

from data.model import Document, OUT, write_json
from data.scrape_runbooks import source_id

HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$", re.M)
URL = re.compile(r"https?://[^\s<>)\]}]+")
COMMENT = re.compile(r"<!--.*?-->", re.S)
REVIEW = re.compile(r"(?:incident review|post.incident review|review will be posted|review will follow)[^\n]{0,200}?(?:/issues/|(?<![\w-])#)(\d+)", re.I)
LOCAL_REF = re.compile(r"gitlab-com/gl-infra/production#(\d+)\b")
REVIEW_SECTIONS = re.compile(r"current status|next steps|incident review|post.incident|summary|resolution", re.I)
LOCAL_ISSUE = re.compile(r"https?://gitlab\.com/gitlab-com/gl-infra/production/(?:-/)?issues/(\d+)\b[^\s<>)\]}]*|(?<![\w/])#(\d+)\b")
FIX_SECTION = re.compile(r"corrective.action|follow.up|next steps|remedia", re.I)
CAUSAL = re.compile(
    r"\b(?:caused by|causing|triggered by|root cause|due to|because|related to|"
    r"workaround|mitigat(?:ed|ion)|recovered|restored|rolled back|reverted|fix(?:ed|es)?)\b", re.I
)


def heading_name(value):
    return re.sub(r"^[^\w]+", "", value.strip()).lower().rstrip(":").strip()


def sections(body):
    matches = list(HEADING.finditer(body))
    result = {}
    for i, match in enumerate(matches):
        name = heading_name(match[2])
        end = next((x.start() for x in matches[i + 1:] if len(x[1]) <= len(match[1])), len(body))
        result.setdefault(name, body[match.end():end].strip())
    return result


def strip_boilerplate(body):
    for match in reversed(list(HEADING.finditer(body))):
        if heading_name(match[2]).startswith("references and helpful links"):
            end = next((x.start() for x in HEADING.finditer(body, match.end()) if len(x[1]) <= len(match[1])), len(body))
            body = body[:match.start()] + body[end:]
    return body


def scrub(body, iid):
    body = LOCAL_REF.sub(lambda m: "[reference removed]" if int(m[1]) > iid else m[0], body)
    return LOCAL_ISSUE.sub(lambda m: "[reference removed]" if int(m[1] or m[2]) > iid else m[0], body)


def review_iid(body):
    parts = sections(body)
    for name, text in parts.items():
        if REVIEW_SECTIONS.search(name) and (match := REVIEW.search(f"{name}\n{text}")):
            return match[1]
    return ""


def links(body):
    for match in URL.finditer(body):
        parsed = urlsplit(match[0].rstrip(".,;"))
        if parsed.netloc == "gitlab.com":
            yield urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def fix_id(url):
    path = urlsplit(url).path
    if path.startswith("/gitlab-com/runbooks/") and "/docs/" in path and path.endswith(".md"):
        return source_id("docs/" + path.split("/docs/", 1)[1])
    return url


def parse_many(rows, get_review=None, fallback=None):
    bodies = [strip_boilerplate(COMMENT.sub("", row.get("description") or "")) for row in rows]
    frequencies = Counter(url for body in bodies for url in set(links(body)))
    common = {url for url, count in frequencies.items() if count > len(rows) * .10}
    output = []
    for row, body in zip(rows, bodies):
        iid = row["iid"]
        labels = row.get("labels") or []
        services = [label.split("::", 1)[1] for label in labels if label.startswith("Service::")]
        causes = [label.split("::", 1)[1] for label in labels if label.startswith("RootCause::")]
        cause = causes[0] if len(causes) == 1 else "unlabeled"
        review_id = review_iid(body)
        review = get_review(review_id) if get_review and review_id else {}
        review_text = scrub(strip_boilerplate(COMMENT.sub("", review.get("description") or "")), iid)
        body = scrub(body, iid)
        parts = sections(body)
        impact = URL.sub("", parts.get("customer impact", "").split("\n#")[0]).strip()
        used_fallback = len(impact.split()) < 20 and fallback is not None
        if len(impact.split()) < 20:
            impact = fallback(body) if used_fallback else ""
        impact = URL.sub("", scrub(impact, iid)).strip()
        symptom = (impact + ("\nAffected services: " + ", ".join(services) if services else "")) if impact else ""
        followups = {url for name, text in parts.items() if FIX_SECTION.search(name) for url in links(text)}
        refs = set()
        for url in set(links(body)) - common:
            if review_id and url.endswith("/issues/" + review_id):
                continue
            if (re.search(r"/merge_requests/\d+$", url) or fix_id(url) != url
                    or (url in followups and re.search(r"/issues/\d+$", url))):
                refs.add(fix_id(url))
        alert = next((value for url in URL.findall(row.get("description") or "")
                      for value in parse_qs(urlsplit(url).query).get("issue[title]", []) if value.strip()), "")
        title = row.get("title") or f"Incident {iid}"
        severity = next((l for l in labels if re.match(r"^severity(?:::|[: ])", l, re.I)), "")
        cleaned = body
        for url in set(links(body + "\n" + review_text)) & common:
            cleaned = cleaned.replace(url, "[template reference removed]")
            review_text = review_text.replace(url, "[template reference removed]")
        output.append(Document(
            id=f"inc-{iid}", iid=iid, title=title, created_at=row["created_at"],
            closed_at=max(row.get("closed_at") or "", review.get("closed_at") or "", review.get("created_at") or ""),
            url=row.get("web_url", ""), alert_title=scrub(alert, iid), services=services,
            root_cause=cause, severity=severity, symptom_text=symptom, review_id=review_id,
            review_text=review_text, fix_refs=sorted(refs), used_fallback=used_fallback,
            full_text=f"# {title}\n\n## Impact\n{impact}\n\n## Incident record\n{cleaned}\n\n## Review\n{review_text}\n\n## Fix references\n" + "\n".join(sorted(refs))))
    return output, common


def leak_flags(doc):
    terms = [t for t in re.split(r"\W+", doc.root_cause.lower()) if len(t) > 2 and t != "unlabeled"]
    text = doc.symptom_text.split("\nAffected services:", 1)[0]
    hits = {m[0].lower() for m in CAUSAL.finditer(text)}
    hits.update(t for t in terms if re.search(rf"\b{re.escape(t)}\b", text, re.I))
    return sorted(hits)


def coverage(rows, docs, common):
    years = defaultdict(Counter)
    for row, doc in zip(rows, docs):
        years[doc.created_at[:4]].update(["total"] + (["parseable_impact"] if doc.symptom_text and not doc.used_fallback else []))
    labeled = [doc for doc in docs if doc.root_cause != "unlabeled"]
    return dict(total=len(rows), labeled=len(labeled),
                eligible=sum(bool(d.symptom_text) and not leak_flags(d) for d in labeled),
                root_causes=dict(Counter(d.root_cause for d in docs)),
                services=dict(Counter(s for d in docs for s in d.services)),
                per_year=dict(years), reviews=sum(bool(d.review_id) for d in docs),
                alert_titles=sum(bool(d.alert_title) for d in docs),
                labeled_fix_refs=sum(bool(d.fix_refs) for d in labeled), boilerplate=sorted(common),
                fallback_count=sum(d.used_fallback for d in docs))


def prepare(args):
    from data.scrape_gitlab import incidents, review
    from data.scrape_runbooks import runbooks
    from api.briefing import extract_symptom

    rows = list(incidents(args.limit or None, args.since))
    docs, common = parse_many(rows, None if args.skip_reviews else review, extract_symptom if args.llm_fallback else None)
    stats = coverage(rows, docs, common)
    stats["review_text_loaded"] = not args.skip_reviews
    if args.without_runbooks:
        books = []
    else:
        earliest = min(doc.created_at for doc in docs)
        books, stats["runbooks_commit"] = runbooks(earliest)
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "leak-lint.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["id", "flags", "symptom_text"])
        for doc in docs:
            if flags := leak_flags(doc):
                writer.writerow([doc.id, "|".join(flags), doc.symptom_text])
    with (OUT / "manifest.jsonl").open("w") as manifest:
        for doc in [*docs, *books]:
            (OUT / f"{doc.id}.md").write_text(doc.full_text)
            manifest.write(json.dumps(doc.json(), ensure_ascii=False) + "\n")
    write_json(OUT / "coverage.json", stats)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--since", default="")
    parser.add_argument("--skip-reviews", action="store_true")
    parser.add_argument("--without-runbooks", action="store_true")
    parser.add_argument("--llm-fallback", action="store_true")
    from dotenv import load_dotenv
    load_dotenv()
    prepare(parser.parse_args())
