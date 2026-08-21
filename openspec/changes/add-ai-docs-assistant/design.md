## Context

See `proposal.md` for motivation and change scope. The implementation spans two independently deployed repositories:

- This repository contains the Next.js 16 Pages Router application, PostgreSQL/Prisma configuration and metrics, admin UI, corpus build, and the browser assistant. It currently has a mock assistant transport and a broad compatibility `/api/chat` proxy, but no production `/api/docs-query` route.
- `../deepdocsengine` is a Rust service that currently couples retrieval and completion, ingests at startup, and uses Qdrant. Its existing hybrid search applies lexical ranking only to dense candidates, and its citations do not contain trusted site URLs or anchors.

The services have different trust and release boundaries. Only Next.js is public. The engine and Qdrant are private services, PostgreSQL is the authority for runtime enablement and quotas, the docs build is the authority for source URLs and anchors, and AvalAI is used for completion only through Next.js. The embedding provider remains an engine deployment concern and is selected by the Gate Zero provider check in `final-step.md`; this design does not assume that AvalAI supports embeddings.

The existing deployment uses standalone Next.js replicas. Consequently, process memory cannot be the authority for minute/day quotas or configuration, although a per-replica concurrency guard and a short configuration cache are valid. The browser's `sessionId` and page metadata are untrusted hints, not authentication or authoritative source metadata.

The implementation must preserve a single browser event contract for mock and production transports, avoid storing conversation content, and make releases reversible across a docs build, an engine build, a Qdrant collection, and a PostgreSQL migration. The canonical limits, response literals, evaluation gates, and rollout stages are defined in `final-step.md` and are not redefined as product choices here.

## Goals / Non-Goals

**Goals:**

- Establish an explicit orchestration boundary: Next.js validates, limits, retrieves, prompts, streams, and measures; Rust ingests and retrieves; Qdrant indexes the corpus; AvalAI only completes.
- Make every linked citation traceable to metadata emitted by the same docs build and returned by the same retrieval request, never to a URL or anchor authored by the model.
- Define deterministic deadline, retry, cancellation, terminal-event, and resource-release behavior across browser, Next.js, engine, embedding provider, Qdrant, and AvalAI.
- Make dense and lexical recall genuinely independent before fusion, with a versioned retrieval configuration and measurable abstention threshold.
- Make corpus replacement immutable and reversible through versioned Qdrant collections and an atomic alias switch.
- Enforce minute/day limits atomically across replicas for both HMAC(IP) and HMAC(session), while bounding active streams independently.
- Keep keys independently rotatable, runtime configuration quickly refreshable, and observability useful without retaining user text or stable raw identifiers.
- Define cross-repository release ordering in which incompatible components remain disabled until their contracts and evaluation gates pass.

**Non-Goals:**

- Copying the Rust engine into this repository, adding it as a submodule, or allowing browsers to access it directly.
- User identity, durable conversations, profile personalization, response replay, or analytics over prompt/answer/source text.
- Autonomous actions, command execution, tools, a command registry, or guarantees beyond measured grounding and correctness gates.
- A second vector database, a new reranker, Redis, or a second completion provider.
- Runtime corpus mutation by the query service or reindexing during service startup.
- User control of models, prompts, retrieval parameters, token budgets, provider payloads, or server settings.
- Defining product behavior beyond `final-step.md`, including new modes, persistence, or fallback answers when sources are insufficient.

## Decisions

### 1. Keep retrieval and completion as separate service responsibilities

The browser calls only `POST /api/docs-query`. Next.js calls authenticated `POST /retrieve` on the private Rust service, validates the returned source envelope again, constructs Prompt v1, and calls AvalAI. The engine owns corpus ingestion, embedding, Qdrant access, independent candidate generation, fusion, thresholding, and source selection. It does not receive history, the system prompt, the AvalAI key, or completion configuration.

This split keeps the encrypted admin-managed AvalAI key in the existing PostgreSQL-backed control plane, gives both `/api/docs-query` and compatibility `/api/chat` one hardened AvalAI client, and prevents two prompt/stream implementations from drifting. `/query` remains authenticated only during parity and is then removed.

Alternatives considered:

- Keep completion in Rust: rejected because it duplicates configuration, key custody, prompting, streaming, metrics, and quota behavior.
- Perform retrieval in Next.js: rejected because it duplicates the engine and weakens the separate deployment boundary.
- Expose the engine to the browser with CORS: rejected because CORS is not authentication and would expose the token and raw source context.

### 2. Treat every hop as a distinct trust boundary

The boundaries and accepted data are:

| Boundary | Trust decision |
|---|---|
| Browser to Next.js | The body, `sessionId`, history, page title/path, origin, host, content type, and disconnect state are untrusted. Next.js enforces the fixed 32 KB and field limits, rejects unknown/provider fields, and derives client IP only from the explicitly configured Liara-approved header. |
| Next.js to PostgreSQL | PostgreSQL is authoritative for the enable flag, encrypted AvalAI settings, quotas, audit metadata, and aggregate metrics. Application input is never interpolated into SQL. Conversation and source text never cross this boundary for persistence. |
| Next.js to engine | Only a bounded query, validated internal page path, and limit are sent over the private network with `ENGINE_API_TOKEN`. Next.js still treats the response as untrusted and allowlists fields, source count, strings, internal URLs, anchors, and total context length. |
| Engine to embedding provider/Qdrant | The engine supplies only the query or release-job corpus chunks. Provider output dimensions and Qdrant payloads are validated against the active collection manifest. Neither is allowed to supply authoritative site URLs independently of the manifest. |
| Next.js to AvalAI | The server supplies a versioned system prompt, bounded history/current request, delimited untrusted source text, server-selected model, and output limit. Only a normalized subset of provider SSE is accepted. |
| Next.js to browser | Only normalized events, allowlisted source display metadata, public error codes, request IDs, safe usage metadata, and response text are returned. Raw provider/engine errors, context bodies outside the source contract, headers, and secrets are excluded. |
| Admin to Next.js | Existing admin authentication applies. Key reads are always masked/write-only; tests and saves use allowlisted hosts/models and emit content-free audit metadata. |

Engine `/health` remains public and shallow. Readiness is separate and reports engine process, Qdrant connectivity, and active collection existence as distinct states without exposing credentials or internal errors. `/retrieve`, temporary `/query`, `/ingest`, and `/documents` require bearer authentication; document-writing routes are additionally unreachable from the public network. Engine CORS support is removed.

Alternative considered: trust private networking alone. Rejected because routing mistakes and lateral access remain possible; bearer authentication and network isolation address different failures.

### 3. Use one bounded request state machine and one absolute deadline

At request acceptance, Next.js creates `requestId`, an `AbortController`, monotonic start time `t0`, and absolute deadline `D = t0 + 45s` (or the configured total timeout, whose initial value is 45 seconds). Every child operation receives a signal linked to the request controller and a timeout no greater than `D - now`. Wall-clock time is used for timestamps; elapsed-time decisions use a monotonic clock.

The route proceeds through these states:

1. `accepted`: validate method, origin/host, content type, raw body size, schema, and fixed bounds before any upstream call.
2. `limited`: read configuration and atomically consume the four PostgreSQL buckets. Disabled/unconfigured state returns `503`; rejection returns `429` and the maximum applicable aligned-window `Retry-After`. Database failure returns `503`. No engine/provider call occurs in these cases.
3. `retrieving`: acquire the per-replica concurrency slot, then call `/retrieve`. The engine call has a 3-second hard cap and is also capped by the remaining total deadline. Engine HTTP and embedding/Qdrant clients use the smaller of their configured cap and propagated remaining deadline.
4. `abstaining`: if retrieval returns `insufficient_context` or no valid source survives proxy validation, do not call AvalAI. Emit the canonical no-source response through the normal event contract with `sources: []` and finish.
5. `starting_provider`: build the bounded prompt and start AvalAI. The deadline for receiving AvalAI's first valid response frame is `min(t_provider_start + 10s, D)`. The maximum output is initially 800 tokens.
6. `streaming`: after upstream response validity is established, send normalized browser events in canonical order and continue only until `D`.
7. `terminal`: send `done` or `error` exactly once when possible, close the response, record safe metrics best-effort, and release the concurrency slot in a `finally` path.

The rate/config target of 150 ms is an observed p95 budget, not an additional deadline that permits bypassing limits. If database work consumes more time, later stages receive only the remaining total budget. Retrieval timing includes the engine's embedding and Qdrant work. The 10-second first-byte limit is measured from the AvalAI attempt start and may never extend the 45-second request deadline.

AvalAI permits at most two retries after the initial attempt, with bounded jitter, only for `429` or `5xx`, only before any provider content has been committed to the browser, and only when both the first-byte and total deadlines have enough remaining time for another attempt. `Retry-After` may delay a retry only within those deadlines. DNS, TLS, malformed payload, validation, authentication, explicit abort, and other `4xx` failures are not retried. Retrieval is not automatically retried by the proxy because it spends the latency budget and can amplify embedding load; release-level availability is handled by service deployment and Qdrant persistence.

The route does not commit HTTP `200` until validation, quota, retrieval, and provider-start checks that can still map cleanly to `400/413/429/502/503/504` have completed. For the deterministic no-source path, it can commit once retrieval is validated. Once HTTP `200` is committed, status changes are impossible: any failure produces at most one terminal `error` event with public code/request ID and then closes. No `done` follows `error`. Before commitment, errors use the documented HTTP status and a small JSON error body. A proxy heartbeat, if required, is only `: ping`; it cannot commit a stream before the route is otherwise ready and does not alter UI state.

Canonical successful ordering is `meta`, `sources`, zero or more `delta`, optional `suggestions`, then `done`. The restricted provider parser bounds bytes per frame, buffered partial-frame bytes, and aggregate output; rejects unsupported event shapes; handles arbitrary network chunk boundaries; and stops at the output limit. Suggestions are emitted only under the source-supported behavior in `final-step.md`; they are never used to keep a failed stream alive.

Cancellation sources are browser socket close, UI Stop, stage timeout, total deadline, server shutdown, or parser/output failure. Any source aborts the request controller. The signal is propagated to the in-flight engine/AvalAI request; Rust propagates cancellation to embedding/Qdrant work where the clients support it and otherwise drops the result. Cancellation stops retries and writes. If the browser is still writable after a server timeout, the proxy emits terminal `error`; on a disconnected socket it only closes resources and records `cancelled`. A user Stop maps to `finishReason: cancelled` only if a writable normal terminal event can still be delivered; it never fabricates completion after disconnect. Success, error, timeout, malformed stream, and disconnect all execute the same slot-release path.

Alternatives considered:

- Independent relative timeouts at each layer: rejected because their sum can exceed the user-visible deadline.
- Retry after partial output: rejected because replay can duplicate or contradict streamed text.
- Buffer the entire completion before responding: rejected because it violates the streaming/first-token objective.
- Send `200` before retrieval/provider startup: rejected because predictable pre-stream failures would lose meaningful HTTP statuses.

### 4. Build a reproducible corpus and make its manifest authoritative

The docs release build produces Markdown under `public/llms/**/*.md` and a versioned manifest from the same route/heading build inputs. Each document/section entry contains at least:

- schema version and a stable source-entry identifier;
- corpus-relative `filename`;
- display `title`;
- canonical internal `url`;
- heading text and the actual emitted MDX `anchor` (empty only for a document-level chunk);
- source line range or the information required for the chunker to preserve it;
- a content hash tied to the exact normalized content used for ingestion.

The top-level collection manifest records embedding provider, embedding model, vector dimension, chunker version, corpus commit, build timestamp, retrieval configuration/threshold version, and the corpus-manifest digest. File paths are normalized, unique, relative, and collision-checked. URLs must be internal built routes, and anchors must exist in that same build's rendered heading map. Every corpus file must match manifest entries and every ingested entry must resolve to a corpus file; mismatches, duplicate filename/URL/anchor identities, an empty corpus, missing mount, bad hash, or vector-dimension mismatch fail the release job before it creates deletions or changes the active alias.

`public/llms/**/*.md` plus its same-build manifest is the production namespace. Until the missing converter is repaired, an explicitly selected `src/pages/**/*.mdx` fallback uses a different namespace and manifest identity so fallback and generated entries cannot collide. A release never silently combines them.

Chunk payloads carry trusted metadata copied from the validated manifest: filename, title, URL, anchor, heading, line range, content hash, corpus version, and namespace. The chunker may split section text but cannot synthesize a route or anchor. Hash skipping is allowed only when the full collection-manifest compatibility tuple matches; model, dimension, chunker version, or incompatible manifest changes force a new collection and full embedding pass.

Alternatives considered:

- Infer URLs/anchors from filenames in Rust: rejected because framework routes and generated heading slugs can diverge.
- Crawl the deployed site: rejected because it disconnects ingestion from the source commit and weakens reproducibility.
- Delete stale points before validating input: rejected because a missing mount could erase a healthy corpus.

### 5. Generate dense and lexical candidates independently, then fuse

Each indexed chunk has a dense vector and a lexical representation in Qdrant. Lexical indexing uses the engine's versioned tokenizer/analyzer suitable for the corpus languages and is generated for the entire corpus, not from dense results. At query time the engine issues independent corpus-wide dense and lexical searches. Neither candidate set is filtered by membership in the other. Page path may be used only as bounded query context/boost under the versioned retrieval configuration, never as authority or an exclusion that forces an answer.

The engine deduplicates by chunk/source identity, fuses the two ranked lists with a deterministic versioned rank-fusion policy, applies any deterministic reranking/adjacent-chunk policy included in that same retrieval version, and considers at most eight fused candidates. It then applies the versioned sufficient-context threshold, removes empty, duplicate, and out-of-corpus entries, and returns at most five sources. Request-local IDs `S1` through `S5` are assigned only after final ordering and are not persisted.

Threshold and fusion versions are recorded in the collection manifest and evaluation report. A threshold change is evaluated against the versioned dataset before alias promotion. If no candidate passes, the engine returns `insufficient_context: true` and no sources; it never promotes a weak candidate merely to fill the limit.

Alternatives considered:

- Apply BM25/lexical scoring only to dense top-k: rejected because keyword-only matches absent from dense top-k remain unrecoverable.
- Add a separate search database: rejected as out of MVP and operationally unnecessary for the required independent candidate generation.
- Let the LLM choose or invent citations: rejected because source selection and URL validity must be deterministic and evaluable.

### 6. Use immutable Qdrant collections behind one active alias

Collections use a unique versioned physical name derived from the corpus/retrieval compatibility version; `liara-docs-active` is the stable query alias. A release job performs this lifecycle:

1. Validate the complete corpus and manifest without touching the alias.
2. Create a new collection with the declared dense/sparse configuration and vector dimension.
3. Create required payload indexes, including filename and URL, before production querying.
4. Batch embed/upsert all required chunks, verify counts/hashes/metadata, and persist the collection manifest as release evidence.
5. Run readiness and the versioned retrieval evaluation directly against the physical candidate collection.
6. If every gate passes, atomically replace the alias target using Qdrant alias operations.
7. Keep the immediately previous physical collection intact and record it as the rollback target.

The query service resolves only the alias in normal operation and never runs a full index at startup. It fails readiness if Qdrant is unreachable or the alias/target is absent, distinguishing those states. Replacement never deletes from or upserts into the active physical collection. Failed candidate ingestion/evaluation deletes only the unused candidate after evidence is retained. Old collections beyond the retained rollback target are removed only by an explicit post-release cleanup policy, never as part of alias promotion.

Rollback atomically points the alias to the recorded previous compatible collection. Next.js can independently stop new public requests immediately with `assistantEnabled=false`. Persistent Qdrant storage is mandatory, and restart plus alias-rollback tests are release evidence.

Alternative considered: update one collection in place with delete-then-upsert. Rejected because readers can observe partial state and rollback cannot be atomic.

### 7. Enforce four PostgreSQL buckets in one all-or-nothing transaction

For each accepted request, Next.js computes `HMAC-SHA-256` values for the trusted client IP and validated session UUID using `ASSISTANT_HMAC_SECRET`. Raw values are discarded before persistence/logging. It derives four bucket rows:

- IP/minute with the aligned UTC minute start and 60 seconds;
- IP/day with the aligned UTC day start and 86,400 seconds;
- session/minute with the aligned UTC minute start and 60 seconds;
- session/day with the aligned UTC day start and 86,400 seconds.

The logical bucket key includes the subject kind (`ip` or `session`) and request class (`docs_assistant`, with `chat` separate) in the HMAC input/domain separation so equal raw values and compatibility traffic cannot share or bypass buckets. The database uniqueness key is `(keyHash, windowStart, windowSeconds)` as specified.

One PostgreSQL transaction processes the four rows in stable key order to minimize deadlocks. For each row it uses a single atomic insert-or-conditional-update statement equivalent to `INSERT ... count = 1 ON CONFLICT ... DO UPDATE SET count = count + 1 WHERE count < limit RETURNING count`. Limits are validated positive integers read from the same configuration snapshot. Exactly one returned row is required for every check. If any statement returns no row, the transaction is rolled back, so neither that failed bucket nor any other bucket is consumed. Concurrent transactions serialize on the unique row locks; no read-then-write allowance decision is used. Transient serialization/deadlock retries, if needed, are bounded by the remaining request deadline and do not permit upstream access before commit.

On rejection, `Retry-After` is the ceiling in seconds until the end of the longest currently blocking aligned window. The public response does not identify whether IP or session caused it. If the transaction cannot commit, the assistant fails closed with `503`; retrieval and AvalAI are not called. Expired rows are removed by a periodic job using an index on `windowStart`; cleanup is not in the request path.

Active-request concurrency is intentionally separate. Each Next.js replica owns a bounded in-process semaphore sized by `ASSISTANT_MAX_CONCURRENCY`; it covers retrieval through stream termination and releases in `finally` for every terminal path. It bounds local sockets/memory/provider work but is not represented as a time bucket. Minute/day quotas remain globally authoritative in PostgreSQL. The initial per-replica value is load-tested; no unlimited value is accepted.

`/api/chat` uses separately domain-separated buckets and a restricted compatibility contract so it cannot consume assistant identity space or bypass assistant limits. Admin connection tests have another small quota and do not mutate saved configuration.

Alternatives considered:

- In-memory minute/day counters: rejected because replicas disagree and restarts reset state.
- Four independent transactions: rejected because rejection could consume unrelated buckets.
- Redis: rejected because PostgreSQL already provides the required atomicity without a new service.
- Hold a PostgreSQL row/transaction for stream concurrency: rejected because long-lived streams would consume connections and complicate crash recovery; the specified concurrency bound is per replica.

### 8. Separate runtime configuration, secret custody, and rotation domains

PostgreSQL `Config` remains authoritative for `assistantEnabled`, positive minute/day limits, allowlisted AvalAI base URL, default model, and encrypted AvalAI key. Next.js caches only non-conversation configuration and decrypted key material in server process memory for at most 30 seconds; cache entries never contain prompts, answers, histories, source bodies, or per-request Authorization data. A successful admin save invalidates the local cache immediately, while the TTL bounds propagation to other replicas.

The AvalAI key is encrypted at rest with a versioned envelope. Encryption-key rotation adds a new key version, allows decrypt-old/encrypt-new during a controlled migration, rewrites ciphertext, verifies it, and only then retires the old decrypt key. `ENCRYPTION_SECRET` material is environment-only. Admin APIs never return plaintext or reusable ciphertext and preserve the current encrypted key when a masked field is left unchanged.

`DOCS_ENGINE_TOKEN` is independent from the AvalAI key and encryption/session/HMAC secrets. Engine-token rotation uses a short deployment-controlled current/next overlap: the engine accepts both during the overlap, Next.js switches to next, successful authenticated readiness is verified, then old is removed. Tokens are compared safely and never logged. HMAC rotation uses explicit key versions/domain separation for new bucket and metric pseudonyms; old bucket rows expire naturally and are not linkable through a stored raw identifier. The HMAC secret remains independent of `SESSION_SECRET`.

AvalAI base URLs are normalized server-side, require HTTPS, and must match `AVALAI_ALLOWED_HOSTS`; redirects to non-allowlisted hosts are rejected rather than followed. The model is selected from server/admin configuration and an allowlist. Admin “Test connection” performs one short server-side completion against only the candidate allowlisted host/model, uses its own quota/deadline, returns no key, and never commits unsaved settings.

Alternatives considered:

- Environment-only AvalAI configuration: rejected because it removes the required runtime admin controls.
- Store the key plaintext in PostgreSQL or expose it back to admin UI: rejected because the database/browser should not independently disclose it.
- Cache configuration indefinitely: rejected because disablement and key rotation must take effect within 30 seconds.

### 9. Normalize AvalAI behind a shared server-only adapter

`src/lib/avalai.js` owns URL/model policy, decryption, request construction, timeout/abort, restricted SSE parsing, safe provider metadata extraction, and pre-byte retry policy. `/api/docs-query` supplies the server-generated model/prompt/context contract. `/api/chat` supplies only its separately validated compatibility subset and cannot pass arbitrary system messages, tools, models, stream options, URLs, or provider fields.

The adapter captures only allowlisted response information such as provider status, `Retry-After`, `avalai-request-id`, finish reason, and provider-reported token usage. It converts provider chunks into internal text/usage records; route-specific code converts those records into the browser event contract. This prevents provider wire details from becoming a public API.

Sources are delimited as untrusted data in Prompt v1. Next.js truncates the total source context to 12,000 characters, preserves request-local source labels, and accepts citations only for returned IDs. Unknown IDs remain text and are never links. The model cannot provide link targets; the UI resolves a known citation ID against the preceding `sources` event.

Alternative considered: pass AvalAI SSE through unchanged. Rejected because it leaks provider coupling, prevents event validation, and makes terminal/error behavior inconsistent.

### 10. Keep mock and real UI transports behind the frozen event contract

The existing component state machine consumes transport events rather than HTTP/provider details. The mock transport supplies the eight deterministic fixtures only in local/preview demo contexts. The production transport sends the fixed request to `/api/docs-query`, incrementally parses normalized SSE, and emits the same typed events. Public production routes select the real transport explicitly and never catch a network failure by falling back to mock.

The transport owns one `AbortController` per request. Stop and component/session teardown abort it. Retry creates a new request with a new request ID from the server while retaining only history allowed by the fixed contract. The reducer accepts canonical event order, ignores no terminal event, and treats malformed ordering, EOF without a terminal event, and terminal `error` after deltas as a broken/failed stream while preserving deterministic partial-response UI behavior.

The UI stores only versioned session state in `sessionStorage`, capped at 10 messages and 100 KB. It renders restricted Markdown through React escaping without raw HTML, resolves only known citation IDs to allowlisted internal source URLs/anchors, and protects external links. Desktop/mobile layout, keyboard behavior, focus return, assistive announcements, Stop/Retry, and section highlighting remain component concerns shared by both transports.

Alternative considered: separate demo and production component trees. Rejected because behavior and security fixes would drift and fixtures would not validate the production state machine.

### 11. Use content-free, request-correlated operations data

Every request gets an opaque `requestId`; the provider request ID is recorded when available. Metrics contain request type, model, status (`ok`, `error`, `timeout`, or `cancelled`), public error class, timestamps, config/rate latency, retrieval latency, first-byte latency, total latency, source count, abstention/empty-retrieval flags, provider-reported input/output tokens, and estimated cost. They do not contain prompt, history, answer, suggestions, source text, raw IP/session, Authorization, decrypted configuration, or internal error bodies.

If pseudonymous abuse/operations correlation is needed, only version-tagged HMAC values with periodic secret rotation are stored; dashboard drill-down remains limited to allowlisted metadata for the same request ID. Config saves and connection tests record `eventType`, admin ID, success, timestamp, and allowlisted metadata only. Retention is explicitly configured for metric, audit, and expired rate-bucket data rather than relying on indefinite defaults.

Dashboard aggregates are split by `chat` and `docs_assistant`: counts/statuses/429, p50/p95 stage latency, daily tokens and estimated cost, abstention rate, average source count, and latest engine/Qdrant/AvalAI-config/ingestion/evaluation states. Metrics writes are best-effort after the policy decisions they describe; a metrics failure cannot break or extend the user stream, but it emits a redacted operational failure signal.

`cost per successful grounded answer` is computed as assistant provider cost divided by responses classified `ok` with at least one valid source, valid citations, and no evaluation/monitoring failure marker. Abstentions are reported separately. Billing reconciliation samples provider usage without adding text retention.

Alternatives considered:

- Store transcripts for debugging: rejected by the privacy boundary.
- Use raw IP/session as dashboard dimensions: rejected because stable personal identifiers are unnecessary for the required metrics.
- Fail the response when metric persistence fails: rejected because observability is not part of answer correctness and should not create duplicate retries/cost.

### 12. Make evaluation and cost budgets release inputs, not post-release reports

The versioned evaluation artifact binds corpus commit/manifest digest, physical collection, embedding provider/model/dimension, chunker version, retrieval/fusion/threshold version, Prompt v1 version, completion model, and token/context budgets. It contains at least the 30 specified Persian/English, typo, page-context, multi-turn, ambiguity, insufficient-context, prompt-injection, and workflow cases with expected sources/anchors, answer points, answer/abstain labels, and applicable follow-up expectations.

Engine evaluation first gates recall@5, URL/anchor validity, abstention, and missing-corpus safety before alias promotion. End-to-end evaluation then gates citation validity, claim support, two-reviewer correctness, security, multi-turn behavior, and no-source zero-call behavior before traffic rollout. UI/accessibility, two-process quota, malformed SSE, timeout/abort, Qdrant restart/rollback, and load tests provide independent release evidence.

The runtime enforces at most five sources, 12,000 source-context characters, 800 output tokens, bounded frames/output, and configured per-replica concurrency. Incremental embedding is limited to compatible unchanged manifest versions; incompatible versions pay the explicit full-reindex cost. The dashboard records a measured baseline and approved threshold for cost per successful grounded answer before 10% rollout. Advancement to 50% and 100% requires both quality/performance gates and that cost threshold; no fixed provider-cost guarantee is inferred.

Alternative considered: optimize cost by caching answers or cross-user contexts. Rejected because it risks stale citations and cross-request data leakage; MVP caching is limited to non-conversation configuration.

## Risks / Trade-offs

- [PostgreSQL becomes a fail-closed dependency for every request] -> Keep the transaction small and indexed, retain the Prisma connection singleton, monitor config/rate p95 separately, and return controlled `503` without contacting upstreams during outages.
- [Four hot bucket rows can contend for high-volume shared IPs] -> Use atomic conditional upserts in stable order, keep transactions free of unrelated work, load-test two or more processes, and tune positive limits without weakening IP-plus-session enforcement.
- [Per-replica concurrency is not a global cluster cap] -> Size it with replica count and provider capacity, monitor active requests/cost, and use database quotas as the global request bound. A distributed concurrency service is intentionally not added for MVP.
- [HMAC rotation temporarily creates new pseudonymous buckets] -> Version rotations operationally, use short controlled transitions, retain minute/day policy monitoring, and never use rotation as a quota-reset mechanism during rollout.
- [Provider retries consume the first-token budget and can add cost] -> Retry only eligible failures before any byte, cap at two retries with jitter, and require remaining first-byte/total budget.
- [Holding HTTP `200` until provider validation delays browser metadata] -> Prefer correct pre-stream HTTP statuses and keep retrieval/provider-start budgets strict; streaming begins as soon as an upstream stream is valid.
- [Cancellation cannot guarantee remote computation stops immediately] -> Propagate abort at every supported client boundary, drop late results, release local resources deterministically, and measure cancellation separately.
- [Lexical tokenization quality may vary across Persian/English text] -> Version the analyzer/fusion policy, include both languages and typos in evaluation, and promote only after recall/abstention gates pass.
- [A corpus build can disagree with rendered routes or MDX anchors] -> Generate route and heading metadata from the same build, validate 100% URL/anchor existence before ingestion, and leave the active alias untouched on mismatch.
- [Immutable collection releases require temporary duplicate Qdrant capacity] -> Capacity-plan for candidate plus active plus retained rollback collection, batch embeddings, skip only compatible hashes, and clean older inactive collections explicitly after the rollback window.
- [Alias promotion can pair a new corpus with an incompatible application prompt/UI] -> Preserve the stable `/retrieve` contract, record compatibility versions, deploy Next.js disabled, and perform end-to-end smoke/evaluation before enablement.
- [The legacy `/api/chat` remains an alternate cost/security surface] -> Apply its own body/quota/model/host/timeout/error controls immediately and remove engine `/query` after parity; do not route assistant traffic through compatibility APIs.
- [A 30-second config cache delays emergency key/flag propagation on other replicas] -> Invalidate locally on save, cap TTL at 30 seconds, test propagation, and use deployment-level secret revocation/network controls for emergencies requiring faster cutoff.
- [Restricted metrics reduce transcript-level debugging] -> Correlate safe stage timings/statuses with request/provider IDs, use deterministic fixtures and versioned evaluations for content defects, and inspect provider systems without copying prohibited content into application storage.
- [Model output can still be wrong despite valid retrieval] -> Enforce request-local citations, deterministic abstention, source-supported commands/suggestions, measured claim-support/correctness gates, progressive rollout, and avoid claiming absolute correctness.
- [Streaming proxies may buffer or terminate idle connections] -> Configure no-buffer SSE headers, add only comment heartbeats if Liara requires them, bound frames/output, and test broken streams in the deployed topology.
- [Feature disablement stops new requests but not necessarily streams already in progress] -> Treat `assistantEnabled=false` as the rollback control for new requests and use deployment/request abort controls if operators must terminate active streams; do not silently substitute mock output.

## Migration Plan

### Phase A: Freeze the browser contract in the docs repository

1. In this repository, finalize the shared request/event contract and all eight deterministic mock fixtures before adding a network transport.
2. Complete UI state, Stop/Retry/follow-up, responsive behavior, keyboard/focus handling, safe citation rendering, accessibility, storage bounds, and malformed/broken-stream behavior against mock transport only.
3. Verify no demo network request, test at the required viewports/themes, and pass `npm test` plus `npm run build`.

Rollback: this phase has no production integration. Revert only the unshipped UI build or keep the demo disabled; no engine, database, or provider state changes exist.

### Phase B: Establish secure retrieval across repositories

1. In this docs repository, repair/gate corpus generation and emit the versioned route/anchor manifest from the same build as `public/llms/**/*.md`. Validate empty/missing corpus, collisions, hashes, routes, and anchors.
2. In `../deepdocsengine`, add bearer middleware to every private route, remove CORS, separate embedding from completion, add bounded clients and `/retrieve`, and retain authenticated `/query` only for temporary parity.
3. In `../deepdocsengine`, implement manifest-driven chunk metadata, independent dense and lexical candidate searches, deterministic fusion/thresholding, readiness details, and release-job ingestion. Ensure startup never reindexes.
4. Provision persistent Qdrant privately. Ingest a new physical collection from one docs build, create indexes, and evaluate it directly with the versioned dataset.
5. Promote `liara-docs-active` atomically only after engine authentication, recall@5, URL/anchor, dimension, empty-corpus, restart, and rollback gates pass. Retain the prior target.

Rollback: do not switch the alias if any pre-promotion step fails. After promotion, atomically restore the previous target. The old engine remains deployable while the stable contract is validated; private-route authentication is a deliberate breaking change and callers must receive tokens before enforcement reaches production.

### Phase C: Add the docs control plane while the feature remains disabled

1. In this repository, apply the PostgreSQL migration for config fields, `RateLimitBucket`, indexes, safe request/provider metrics, and audit metadata as a one-shot job. The migration must be additive so the old docs application can continue running during rollout.
2. Implement the four-bucket atomic transaction, periodic cleanup, per-replica concurrency guard, privacy HMAC domains, shared AvalAI adapter, encrypted/versioned key handling, host/model policy, and bounded configuration cache.
3. Extend admin Settings/Dashboard with masked write-only key management, enable/positive-limit controls, separately quota-limited connection testing, safe aggregates, readiness, ingestion/evaluation state, and audit metadata.
4. Harden `/api/chat` before configuring production credentials: separate quota, model/base URL allowlists, body/field limits, timeout/abort, restricted parser, and redacted errors.
5. Verify Gate Zero with a test key. Configure the engine's separate embedding credential/provider according to that result; never pass the admin AvalAI completion key to the engine.
6. Test key/token rotations, two-process limit atomicity and rollback, database outage fail-closed behavior, 30-second cache propagation, and absence of prohibited data.

Rollback: leave `assistantEnabled=false`. Application code can roll back because the migration is additive; do not drop new columns/tables until all old/new application versions are retired. Revert a failed key rotation to the still-supported old key version, or restore the old engine token during its overlap.

### Phase D: Integrate real orchestration and transport

1. In this repository, implement `/api/docs-query` with validation, origin/host checks, rate/config transaction, concurrency, authenticated retrieval, source revalidation, bounded Prompt v1, deterministic no-source path, AvalAI streaming, normalized SSE, safe metrics, and the absolute deadline/abort state machine.
2. Test all pre-stream statuses, `Retry-After`, exact abstention with zero AvalAI calls, frame/output limits, malformed provider SSE, retries, citation allowlisting, source/context/output caps, timeout at every stage, and browser disconnect propagation against the deployed engine contract.
3. Add the real UI transport behind the frozen event interface. Keep production selection explicit and mock unavailable on public routes.
4. Run end-to-end quality, prompt-injection, accessibility, security, load, cancellation, cost, and privacy evaluations while `assistantEnabled=false`, using an operator-only smoke path where required.
5. Remove Rust `/query` only after `/retrieve` parity and Next.js completion tests pass, eliminating the second LLM path.

Rollback: set `assistantEnabled=false` first, stopping new assistant requests without deployment. Roll back Next.js to the mock/demo-disabled build if needed; the stable engine alias and additive database schema can remain. If retrieval caused the regression, restore the previous Qdrant alias target. Never fall back to mock or uncited AvalAI output in production.

### Phase E: Deploy and progressively enable

The production cross-repository order is fixed:

1. Run the additive PostgreSQL migration.
2. Provision private Qdrant with its persistent volume and verify it is not publicly exposed.
3. Deploy the authenticated Rust engine on the private network with current/next token overlap where rotation is involved.
4. Run the one-shot corpus ingestion into a new physical collection.
5. Run retrieval evaluation and retain its versioned report.
6. Atomically switch the Qdrant alias only after all collection gates pass.
7. Deploy standalone Next.js with production real transport and `assistantEnabled=false`.
8. Configure/test the allowlisted AvalAI key/model and smoke-test admin, rate limits, `/api/docs-query`, streaming, abort, readiness, privacy, and cost measurement.
9. Enable internally, then at 10%, 50%, and 100% only while quality, security, error, latency, quota, cancellation, and approved cost thresholds remain healthy.

At every rollout stage, the first rollback action is `assistantEnabled=false`. If the fault is application-only, roll back Next.js while retaining additive schema and engine. If it is retrieval/corpus-related, disable the feature and atomically restore the previous Qdrant alias. If it is engine-related, restore the previous compatible engine image/token configuration and alias. If it is provider/config-related, disable, restore the prior encrypted key/model/base-URL configuration using supported key versions, and retest server-side. No rollback path exposes the engine publicly, runs startup ingestion, drops the database migration immediately, or substitutes mock responses.

After full rollout and an explicit retention window, remove obsolete inactive Qdrant collections except the required rollback target, retire old engine/encryption keys after verification, and eventually remove compatibility `/query`. Database columns/tables and `/api/chat` are removed only in separate changes after confirmed non-use; this migration does not assume that compatibility behavior can be deleted immediately.
