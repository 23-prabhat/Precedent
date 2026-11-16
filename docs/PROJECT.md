# Precedent

Precedent is an incident-memory workspace for on-call engineers. Enter what you saw when an alert fired. The workspace retrieves earlier incidents, shows how they relate, and lets you record which precedent helped after the incident is resolved.

## Why a constellation?

The homepage uses a continuous 3D particle field to illustrate how alerts become search results. The homepage opens on a gateway 503 alert, traces the match through a confirmed relationship, and presents a suggested configuration check. Then it lets you flip the repository mirror replay between the results before and after saving its resolution. The geometry is illustrative. The highlighted incident IDs and saved relationship come from a synthetic recording shipped with the project.

In **Vector** mode, the alert sits near incidents with similar descriptions. Real semantic search encodes text as a numerical vector. Precedent’s evaluation baseline uses normalized MiniLM embeddings and an exact inner-product index in FAISS. For unit-normalized vectors, that dot product equals cosine similarity. Cosine similarity compares direction in the embedding space. A high score indicates similar text according to the model, while the cause and successful fix still need evidence. The offline demo uses simpler sparse text similarity so it can run without downloading a model.

In **HydraDB graph** mode, a line represents a relationship the system can explain. The example starts with an API gateway alert, recalls incident `INC-142`, and follows a responder-confirmed `SAME_FIX_AS` edge to registry incident `INC-089`. Both incidents recovered after restoring the previous configuration. The top five vector results for that alert omit INC-089. The recorded graph arm reaches it through INC-142. The stored link and its reason are the evidence. The distance between stars is a visual aid. In the repository mirror replay, recording the link from `INC-051` to `INC-028` brings the webhook incident to rank two when the alert is analyzed again.

## What happens in the workspace

1. **Describe the alert.** Include the affected service and observable symptoms. The analysis endpoint retrieves incidents and returns source IDs, relationships, and a short advisory briefing when enough evidence exists.
2. **Inspect the evidence.** Graph evidence shows a connected precedent first when one is available. Open its relationship in the Memory Graph to inspect the source and destination. The Vector Baseline view shows results ranked by text similarity.
3. **Record a resolution.** Supply the confirmed root cause and select the earlier incidents that helped. Recorded mode persists the links locally. In a browser-only static demo, a scripted sample stores the change in the browser session and shows the difference when you analyze it again.

## How HydraDB fits

| Layer | Implementation |
| --- | --- |
| Web | Next.js homepage, analysis workspace, graph explorer, and replay report |
| API | FastAPI analysis, resolution, graph, replay and status endpoints |
| Baseline | MiniLM and FAISS for the real evaluation arm |
| Recorded mode | Synthetic incidents, cached results, and a local SQLite or browser-session ledger |
| Hosted adapter | HydraDB corpus ingestion, hybrid retrieval with graph context, subgraph lookup, and learned-edge writeback |

The hosted adapter asks HydraDB for hybrid results with graph context. The replay isolates flat, auto-graph, declared-graph, and learned variants in separate collections when supported. Once a responder confirms a precedent, the writeback code can upload the resolved incident to the learned collection with a relationship to the known source. A local ledger retains the relationship and why it was written. The replay evaluates each batch before that batch becomes eligible for ingestion.

## Current status

The local workflow runs end to end in recorded mode. The real MiniLM/FAISS baseline was also run against public GitLab data. Its audited cohort scored 77 alerts, with 66 reachable; the vector arm scored 0.178 reachable nDCG@5 and the label-prior control scored 0.197. The [raw aggregate](gitlab-baseline.json) contains the run details. These results establish a baseline. The hosted graph comparison is pending.

HydraDB is unconfigured in this workspace. Live operation requires `HYDRADB_API_KEY`, a verified account contract, and a seeded incident corpus. Set the key in your local `.env` using `.env.example` as a template. Follow the [runbook in the README](../readme.md#evaluate-public-gitlab-history) to run the contract checks, seed the corpus, and verify query and writeback before claiming the live integration is complete.

## Try it locally

Run `make api` and `make web` in separate terminals after installing the dependencies. Open [the homepage](http://localhost:3000/) or [the analysis workspace](http://localhost:3000/analysis). Try the gateway example to inspect a saved relationship, or choose a learning sample and record its resolution. For a static export, run `PRECEDENT_STATIC_DEMO=1 make build` and serve `web/out/`.

Icons are from [Streamline Pixel Mono Free](https://www.streamlinehq.com/icons/pixel), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The constellation and its motion are original code.
