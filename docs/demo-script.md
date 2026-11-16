# Three-minute walkthrough

The [recorded walkthrough](demo.mp4) uses the same static export as the [public demo](https://23-prabhat.github.io/Precedent/). It has on-screen captions.

| Time | Screen | Action |
| --- | --- | --- |
| 0:00 | Homepage | Introduce Track 1 and the recorded gateway HTTP 503 alert. |
| 0:14 | Vector search | Trace the symptom match to INC-142. |
| 0:28 | Graph evidence | Follow the confirmed relationship to INC-089 and compare it with the top five vector results. |
| 0:59 | Analysis | Open the gateway sample in the console and review the evidence. |
| 1:13 | Analysis | Analyze the repository mirror sample. The initial results omit the useful webhook precedent, INC-028. |
| 1:26 | Resolution | Confirm INC-028 as helpful and save the outcome. |
| 1:39 | Analysis and graph | Analyze again and inspect the learned link from INC-051 to INC-028. |
| 2:06 | Replay report | Explain the chronological evaluation and its synthetic provenance. |
| 2:22 | Status | The workflow and public GitLab baseline are reproducible. The hosted comparison is pending. |

With the local API, resolutions persist in SQLite. The static demo replays scripted confirmations in the browser session. See the [pilot plan](go-to-market.md) for the design-partner offer.
