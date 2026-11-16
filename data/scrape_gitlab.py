"""Fetch public incidents and reviews, retaining raw responses locally."""
import argparse
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from data.model import CACHE, write_json

PROJECT = "gitlab-com/gl-infra/production"
API = "https://gitlab.com/api/v4/projects/" + quote(PROJECT, safe="")


def cached_get(url, key):
    path = CACHE / "gitlab" / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    headers = {"User-Agent": "Precedent-research/1.0"}
    if os.getenv("GITLAB_TOKEN"):
        headers["PRIVATE-TOKEN"] = os.environ["GITLAB_TOKEN"]
    for attempt in range(6):
        try:
            with urlopen(Request(url, headers=headers), timeout=25) as response:
                result = {"data": json.load(response), "next_page": response.headers.get("X-Next-Page", "")}
            write_json(path, result)
            return result
        except HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            retry = exc.headers.get("Retry-After", "")
            time.sleep(min(120, int(retry)) if retry.isdigit() else 2 ** attempt)
        except URLError:
            if attempt == 5:
                raise
            time.sleep(2 ** attempt)


def incidents(limit=None, since=""):
    size = 50 if limit == 50 else 100
    page, count = 1, 0
    while limit is None or count < limit:
        params = urlencode(dict(issue_type="incident", state="closed", per_page=size,
                                order_by="created_at", sort="asc", page=page))
        if since:
            params += "&" + urlencode({"created_after": since})
        batch = cached_get(f"{API}/issues?{params}", f"incidents-{since[:10] + '-' if since else ''}{size}-{page}")
        for issue in batch["data"]:
            if limit is not None and count >= limit:
                return
            yield issue
            count += 1
        if len(batch["data"]) < size:
            return
        page = int(batch["next_page"] or page + 1)


def review(iid):
    try:
        return cached_get(f"{API}/issues/{int(iid)}", f"issue-{int(iid)}")["data"]
    except HTTPError as exc:
        if exc.code == 404:
            return {}
        raise


if __name__ == "__main__":
    from dotenv import load_dotenv
    from data.parse import sections, review_iid, coverage, parse_many
    load_dotenv()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--since", default="")
    args = parser.parse_args()
    rows = list(incidents(args.limit or None, args.since))
    if args.limit == 50:
        for row in rows:
            body = row.get("description") or ""
            print(row["iid"], list(sections(body)), row["labels"], review_iid(body))
    docs, common = parse_many(rows)
    print(json.dumps(coverage(rows, docs, common), indent=2))
