"""Entirely synthetic incidents used to exercise the demo and replay."""
from datetime import datetime, timedelta, timezone

from data.model import Document

CASES = [
    ("INC-142", "API requests returned intermittent 503s", "API Gateway", "Config change",
     "API gateway requests returned intermittent HTTP 503s across multiple regions. Health checks were flapping and error rates rose while request volume remained steady.",
     "Gateway retries used an invalid upstream setting. Restoring the previous configuration recovered requests.", "rb-gateway"),
    ("INC-089", "Registry uploads stalled after a policy rollout", "Container Registry", "Config change",
     "Container image uploads stalled during manifest publication. Clients retried and the registry returned incomplete upload responses.",
     "A stale configuration was restored to the last known good version. This is a responder-confirmed precedent for INC-142.", "rb-gateway"),
    ("INC-117", "Regional gateway saturation", "API Gateway", "Capacity",
     "API gateway requests returned intermittent HTTP 503s in one region. The active request queue grew steadily during the traffic peak.",
     "Workers were saturated. Increasing available workers drained the request queue.", "rb-capacity"),
    ("INC-103", "Upstream timeouts on public API", "Public API", "Dependency",
     "Public API requests timed out across multiple regions. Upstream connections stalled and public endpoint health checks were flapping.",
     "The identity dependency was returning timeouts. The dependency recovered after the provider restored service.", "rb-dependency"),
    ("INC-076", "CI jobs queued behind idle runners", "CI Runners", "Config change",
     "Jobs waited in the pending queue for several minutes. Runners were idle and the job scheduler showed assignment delays.",
     "The runner registration policy was restored to its previous version.", "rb-gateway"),
    ("INC-064", "Worker backlog delayed deployments", "CI Runners", "Capacity",
     "Deployment jobs were queued while the pending worker backlog rose steadily. Individual executions completed normally.",
     "Worker capacity was raised and the queue drained.", "rb-capacity"),
    ("INC-051", "Mirroring requests stalled", "Git Storage", "Dependency",
     "Git repository mirror requests were slow and shared storage operations timed out in the primary region.",
     "A shared storage dependency recovered after a provider repair.", "rb-dependency"),
    ("INC-039", "Search indexing lag", "Search", "Capacity",
     "Search results showed stale content and indexing lag grew during a burst of updates.",
     "An extra indexing worker pool drained the backlog.", "rb-capacity"),
    ("INC-028", "Webhook deliveries retried", "Webhooks", "Dependency",
     "Webhooks returned HTTP 502 and end-to-end deliveries retried across multiple regions.",
     "The event broker recovered after maintenance.", "rb-dependency"),
]
BOOKS = [
    ("rb-gateway", "Validate a configuration rollout", "Compare the effective settings with their previous known-good version. Check the rollout timeline against the first errors."),
    ("rb-capacity", "Inspect worker saturation", "Compare queue depth, worker utilization and request volume while errors are active."),
    ("rb-dependency", "Check upstream service health", "Review the affected upstream services and compare timeout rates by region."),
]
SAMPLES = [
    dict(id="gateway", title="API gateway 503s", expected_precedent_id="INC-089",
         note="A cross-service configuration precedent.", alert_text=CASES[0][4]),
    dict(id="runner", title="CI jobs pending with idle runners", expected_precedent_id="INC-089",
         note="A similar fix surfaced through the runner precedent.", alert_text=CASES[4][4]),
    dict(id="registry", title="Container registry uploads stalling", expected_precedent_id="INC-142",
         note="Traverse the confirmed configuration relationship in reverse.", alert_text=CASES[1][4]),
]
TRIPLES = [
    dict(id="triple-gateway", title="Learning demo · API gateway", expected_precedent_id="INC-089",
         alert_text="The API gateway returns intermittent HTTP 503s. Regional health checks are flapping while request volume remains steady.",
         resolution_text=CASES[0][4] + " " + CASES[0][5], root_cause="Config change", withheld_id="INC-142",
         note="Analyze, resolve the gateway incident with INC-089, and run the same alert again."),
    dict(id="triple-runners", title="Learning demo · CI workers", expected_precedent_id="INC-039",
         alert_text="CI jobs are queued behind workers and deployment runs are delayed while the pending worker backlog rises.",
         resolution_text=CASES[5][4] + " " + CASES[5][5], root_cause="Capacity", withheld_id="INC-064",
         note="Confirm the search indexing capacity precedent and inspect the new path."),
    dict(id="triple-mirrors", title="Learning demo · Repository mirrors", expected_precedent_id="INC-028",
         alert_text="Git repository mirror requests stall and shared storage operations time out in the primary region.",
         resolution_text=CASES[6][4] + " " + CASES[6][5], root_cause="Dependency", withheld_id="INC-051",
         note="Confirm the webhook dependency precedent and rerun the alert."),
]


HARD_ALERTS = [
    ("Config change", "Package CDN", "Mirrors reject signed artifacts with HTTP 412. Cached packages remain readable, but initial installs stall."),
    ("Capacity", "Billing", "Invoice generation falls behind its hourly schedule. Scheduled exports take ninety minutes and show empty progress counters."),
    ("Dependency", "Outbound Email", "Delivery notices stop arriving. Mailbox acceptance succeeds and SMTP retries accumulate across different providers."),
    ("Config change", "TLS Frontend", "Fresh certificate chains fail validation on older clients. Existing connections retain successful handshakes."),
    ("Capacity", "Analytics", "Large dashboard exports are truncated with exhausted buffers. Short filters and cached charts still load."),
    ("Dependency", "Persistence", "A standby volume stays read only. Snapshot restores hang during the mounting step while attached disks remain readable."),
    ("Config change", "Artifact Mirror", "Newly published packages resolve to empty URLs. Anonymous downloads return a redirect loop."),
    ("Capacity", "Scheduler", "Scheduled renewal tasks miss multiple deadlines. Interactive actions finish normally with no elevated network errors."),
    ("Dependency", "Feature Flags", "Flag reads remain stale across several deployments. Clients report invalid timestamps and long polls stay open."),
]


def corpus(weeks=0):
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    docs = [Document(id=id_, title=title, doc_type="runbook", full_text=text, created_at="2023-12-31T00:00:00+00:00")
            for id_, title, text in BOOKS]
    for week in range(weeks + 1):
        for j, (id_, title, service, cause, symptom, resolution, book) in enumerate(reversed(CASES)):
            stamp = start + timedelta(days=week * 10 + j)
            docs.append(Document(id=id_ if week == 0 else f"fixture-{week}-{j}", title=title,
                                 full_text=f"{title}\n{symptom}\n{resolution}", services=[service],
                                 created_at=stamp.isoformat(), closed_at=(stamp + timedelta(hours=4)).isoformat(),
                                 symptom_text=symptom, root_cause=cause, fix_refs=[book]))
        if week and week <= len(HARD_ALERTS):
            cause, service, symptoms = HARD_ALERTS[week - 1]
            known = next(case for case in CASES if case[3] == cause)
            stamp = start + timedelta(days=week * 10 + 9)
            docs.append(Document(id=f"fixture-hard-{week}", title=f"{service} degraded", symptom_text=symptoms,
                                 full_text=f"{symptoms}\n{known[5]}", root_cause=cause, services=[service],
                                 created_at=stamp.isoformat(), closed_at=(stamp + timedelta(hours=4)).isoformat(),
                                 fix_refs=[known[6]]))
    return docs


def initial_edges():
    return [
        dict(source="INC-142", target="INC-089", type="SAME_FIX_AS",
             reason="A responder confirmed both incidents recovered after restoring the previous configuration.",
             confirmed_at="2024-01-10T00:00:00+00:00"),
        dict(source="INC-142", target="rb-gateway", type="REFERENCES_FIX", reason="Resolution cites this runbook.",
             confirmed_at="2024-01-10T00:00:00+00:00"),
    ]
