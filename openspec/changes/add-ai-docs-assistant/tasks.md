## 1. Gate Zero - Provider and Embedding Decision

- [x] 1.1 In the current `docs/` repository, run the AvalAI models and embeddings probes with a test key, redact the captured output, and record whether AvalAI provides a stable embedding model and dimension.
- [x] 1.2 In `../deepdocsengine`, select the separate embedding-only provider and deployment credential from the Gate Zero result, verify one bounded embedding request, and set the matching non-mock `VECTOR_SIZE` decision.
- [x] 1.3 Gate Zero: approve the recorded completion-versus-embedding provider boundary, confirm the AvalAI completion key will remain only in the current `docs/` repository, and block Phase B until the embedding provider, model, dimension, and full-reindex rule are explicit.

## 2. Phase A - Frozen Contract and Fixtures

- [x] 2.1 In the current `docs/` repository, define one typed request and transport-event contract for `POST /api/docs-query`, including canonical event order, source fields, terminal error behavior, and the four allowed finish reasons.
- [x] 2.2 In the current `docs/` repository, implement the deterministic `success`, `slow`, `empty`, `rate-limit`, `provider-error`, `broken-stream`, `rich-content`, and `long-thread` mock fixtures using only `S1` through `S5` and canonical events.
- [x] 2.3 In the current `docs/` repository, add contract tests for canonical and malformed event order, duplicate terminal events, EOF without a terminal event, partial output followed by error, source deduplication, and unknown citation IDs.
- [x] 2.4 In the current `docs/` repository, restrict mock transport selection to local or preview demo contexts and add a test proving fixtures make no network request.

## 3. Phase A - Assistant UI and Safety

- [x] 3.1 In the current `docs/` repository, complete launcher, panel, composer, mode selection, streaming, Stop, Retry, follow-up, visible error, stopped, source, and completion states against the mock transport.
- [x] 3.2 In the current `docs/` repository, implement dock-right desktop and bottom-sheet mobile layouts that keep composer, Stop, Retry, and citations operable without horizontal overflow at 360, 768, and 1440 pixels in light and dark themes.
- [x] 3.3 In the current `docs/` repository, implement `Cmd/Ctrl+I`, `Esc`, `Enter`, `Shift+Enter`, logical focus order, focus return, accessible names, visible focus, and assistive announcements without a keyboard trap.
- [x] 3.4 In the current `docs/` repository, implement citation navigation from current-response source IDs only, allowlisted internal URL and anchor resolution, source deduplication, and destination-section highlighting.
- [x] 3.5 In the current `docs/` repository, render restricted Markdown and code blocks with raw HTML disabled, safe internal links, and `noopener noreferrer` on external links.
- [x] 3.6 In the current `docs/` repository, implement versioned `sessionStorage` recovery, corruption reset, and eviction at both 10 messages and 100 KB without identity, profile, synchronization, or replay persistence.
- [x] 3.7 In the current `docs/` repository, test all eight fixtures plus Stop/Retry, malformed streams, XSS, unsafe links, storage corruption/eviction, long threads, unknown citations, section highlighting, and teardown abort behavior.
- [x] 3.8 In the current `docs/` repository, run automated accessibility checks and manual keyboard, focus, announcement, contrast, touch-target, zoom/reflow, and reduced-motion checks at 360, 768, and 1440 pixels in both themes, retaining the results.
- [x] 3.9 Phase A gate: in the current `docs/` repository, pass `npm test` and `npm run build`, confirm no critical or serious accessibility violation or required-viewport overflow, and prove the demo makes no network request.

## 4. Phase B - Reproducible Docs Corpus

- [x] 4.1 In the current `docs/` repository, repair or explicitly gate Markdown generation so one build emits `public/llms/**/*.md` and a versioned manifest from the same route and heading inputs.
- [x] 4.2 In the current `docs/` repository, include stable entry IDs, normalized relative filenames, titles, canonical internal URLs, heading text, emitted anchors, line provenance, content hashes, namespace, schema version, and corpus digest in the corpus manifest.
- [x] 4.3 In the current `docs/` repository, include corpus commit, build timestamp, embedding provider/model/dimension, chunker version, and retrieval/fusion/threshold versions in the collection manifest consumed by `../deepdocsengine`.
- [x] 4.4 In the current `docs/` repository, implement an explicitly selected `src/pages/**/*.mdx` fallback with a distinct namespace and manifest identity, never silently mixing it with `public/llms/**/*.md`.
- [x] 4.5 In the current `docs/` repository, fail corpus validation on missing or empty input, path escape or collision, duplicate filename/URL/anchor identity, missing rendered route or anchor, file/manifest mismatch, or content-hash mismatch.
- [x] 4.6 In the current `docs/` repository, add deterministic corpus-build tests proving 100 percent route/anchor validity, reproducible manifests, namespace isolation, collision handling, and failure before any engine release operation.

## 5. Phase B - Sibling Rust Retrieval Engine

- [x] 5.1 In `../deepdocsengine`, add constant-time current/next bearer-token middleware to `/retrieve`, temporary `/query`, `/ingest`, and `/documents`, leave `/health` shallow and public, and remove browser CORS support.
- [x] 5.2 In `../deepdocsengine`, split embedding/retrieval from completion, add strict `POST /retrieve` request and response schemas with unknown-field rejection and fixed query/limit bounds, and keep `/query` only for authenticated parity.
- [x] 5.3 In `../deepdocsengine`, propagate the smaller configured or remaining deadline and cancellation through embedding and Qdrant clients, bound HTTP work, and expose separate process, Qdrant-connectivity, and active-collection readiness states without internal errors.
- [x] 5.4 In `../deepdocsengine`, ingest only metadata copied from the validated current `docs/` manifest, preserving filename, title, URL, real anchor, heading, line range, hash, corpus version, and namespace without synthesizing routes or anchors.
- [x] 5.5 In `../deepdocsengine`, generate corpus-wide dense and lexical candidates independently, deterministically fuse/deduplicate at most eight candidates under a versioned policy, and apply the versioned sufficient-context threshold.
- [x] 5.6 In `../deepdocsengine`, return at most five nonempty in-corpus sources with request-local `S1` through `S5` IDs, or `insufficient_context: true` with no sources when the threshold is not met.
- [x] 5.7 In `../deepdocsengine`, replace startup ingestion with an explicit release-job command that validates the complete corpus and manifest before collection creation, deletion, stale cleanup, or alias mutation.
- [x] 5.8 In `../deepdocsengine`, implement compatible hash skipping, changed-document batching, vector-dimension validation, payload verification, and full reindex into a new physical collection when model, dimension, chunker, or manifest compatibility changes.
- [x] 5.9 In `../deepdocsengine`, test every private route without valid tokens, CORS absence, strict schemas, timeout/cancellation, metadata trust, independent lexical recall, threshold abstention, duplicate/out-of-corpus filtering, readiness states, and absence of startup reindexing.

## 6. Phase B - Qdrant Release and Retrieval Gate

- [x] 6.1 In `../deepdocsengine`, create a uniquely versioned candidate Qdrant collection with declared dense/lexical configuration and required filename and URL payload indexes, leaving `liara-docs-active` untouched.
- [x] 6.2 In `../deepdocsengine`, ingest and verify all candidate points against the current `docs/` collection manifest, retain collection counts/hashes/metadata as evidence, and delete only an unused failed candidate after preserving failure evidence.
- [x] 6.3 In the current `docs/` repository, create a versioned evaluation set of at least 30 Persian and English cases covering exact keywords, colloquial Persian, typos, page context, simple, complex, multi-turn, ambiguity, insufficient context, prompt injection, and workflows with expected sources/anchors and answer-or-abstain labels.
- [x] 6.4 Across the current `docs/` repository evaluation set and `../deepdocsengine` candidate collection, run retrieval evaluation directly against the physical collection and record corpus, embedding, chunker, fusion, threshold, and dataset versions.
- [x] 6.5 In `../deepdocsengine`, test missing/empty corpus, manifest mismatch, vector mismatch, Qdrant timeout, unchanged/changed hashes, incompatible full reindex, and failed evaluation, proving no active collection deletion or alias movement.
- [x] 6.6 In `../deepdocsengine`, test Qdrant persistence across restart, atomic alias promotion, retention of the immediately previous target, and atomic rollback without startup ingestion.
- [x] 6.7 Phase B gate: across the current `docs/` repository and `../deepdocsengine`, require valid bearer rejection, recall@5 of at least 80 percent, URL and anchor validity of 100 percent, abstention precision of at least 95 percent, dimension/count/hash checks, empty-corpus safety, and restart/rollback success before atomically promoting `liara-docs-active`.

## 7. Phase C - Prisma and Runtime Controls

- [x] 7.1 In the current `docs/` repository, add an additive Prisma migration for disabled-by-default assistant configuration, positive bounded minute/day limits, `RateLimitBucket` uniqueness and cleanup index, privacy-safe request/provider metrics, audit metadata, retention configuration, and ingestion/evaluation state.
- [x] 7.2 In the current `docs/` repository, implement one stable-order PostgreSQL transaction that atomically conditionally consumes aligned UTC IP/minute, IP/day, session/minute, and session/day buckets using domain-separated HMAC keys.
- [x] 7.3 In the current `docs/` repository, compute longest-blocking-window `Retry-After`, roll back every bucket on rejection, fail closed on database errors, bound deadlock retries by the request deadline, and add periodic expired-bucket cleanup outside the request path.
- [x] 7.4 In the current `docs/` repository, add the bounded per-replica concurrency semaphore and tests proving release on success, error, timeout, malformed stream, Stop, and disconnect independently of PostgreSQL quotas.
- [x] 7.5 In the current `docs/` repository, implement a maximum-30-second non-conversation configuration cache with immediate local invalidation and no prompt, answer, history, source body, authorization, or per-request data.
- [x] 7.6 In the current `docs/` repository, implement versioned AvalAI key envelopes and decrypt-old/encrypt-new migration, independent versioned HMAC rotation, and deployment-controlled engine-token current/next overlap.
- [x] 7.7 In the current `docs/` repository, test two-process final-allowance serialization, all-or-nothing four-bucket rollback, aligned windows and cleanup, database-outage fail-closed behavior, trusted client-IP extraction, HMAC domain separation, cache isolation, and 30-second config/key propagation.

## 8. Phase C - AvalAI, Administration, and Legacy Chat

- [x] 8.1 In the current `docs/` repository, create the shared server-only AvalAI adapter with HTTPS host and model allowlists, redirect rejection, encrypted key loading, bounded request construction, abort/deadline propagation, and safe provider metadata extraction.
- [x] 8.2 In the current `docs/` repository, implement a chunk-boundary-safe restricted provider SSE parser with per-frame, partial-buffer, aggregate-output, and initial 800-token limits plus at most two jittered pre-byte retries for only `429` or `5xx` within both deadlines.
- [x] 8.3 In the current `docs/` repository, extend authenticated Settings APIs and UI for masked write-only key state, allowlisted base URL/model, disabled-by-default enable switch, and positive bounded minute/day limits with local cache invalidation.
- [x] 8.4 In the current `docs/` repository, add separately quota-limited Test connection behavior that performs one short server-side completion against candidate allowlisted settings without returning the key or committing edits.
- [x] 8.5 In the current `docs/` repository, record content-free config-save and connection-test audit events and safe request metrics with request/provider IDs, request type, status, stage latencies, usage/cost, source count, and abstention classification.
- [x] 8.6 In the current `docs/` repository, extend the dashboard with split `chat`/`docs_assistant` aggregates, `429` and terminal counts, p50/p95 stage latency, token/cost, abstention, source count, dependency readiness, ingestion/evaluation status, filters, and safe request-ID drill-down.
- [x] 8.7 In the current `docs/` repository, implement and test the defined cost-per-successful-grounded-answer calculation, excluding abstentions and responses lacking valid sources/citations or carrying evaluation/monitoring failure markers.
- [x] 8.8 In the current `docs/` repository, harden `/api/chat` with a restricted compatibility schema, separate HMAC quota domain, body/field/model/host limits, shared AvalAI parser, timeout/abort, and sanitized errors before production credentials are configured.
- [x] 8.9 In the current `docs/` repository, test SSRF/redirect/model rejection, key masking and rotation, connection-test isolation/quota, parser chunk boundaries and limits, retry eligibility, audit/metric redaction, dashboard classification, and `/api/chat` bypass resistance.
- [x] 8.10 Phase C gate: in the current `docs/` repository, apply and roll back application code over the additive migration, prove keys and prohibited content never reach browser/database/log/metric/audit/cache captures, and pass two-process atomic-limit plus independent key/token rotation tests while `assistantEnabled=false`.

## 9. Phase D - Real Query Proxy

- [x] 9.1 In the current `docs/` repository, implement raw 32 KB request handling and strict `/api/docs-query` validation for method, origin, host, content type, UUID session, three modes, trimmed message, bounded history, internal page path, untrusted title, and unknown/provider field rejection.
- [x] 9.2 In the current `docs/` repository, implement the absolute monotonic 45-second request state machine with request ID, linked abort signals, fail-closed config/rate admission, and concurrency acquisition before authenticated retrieval.
- [x] 9.3 Across the current `docs/` repository and `../deepdocsengine`, integrate bearer-authenticated `/retrieve` with a 3-second cap, bounded current-message/page-path query input, response allowlisting, internal URL/anchor validation, deduplication, five-source cap, and 12,000-character context cap.
- [x] 9.4 In the current `docs/` repository, implement Prompt v1 with delimited untrusted sources, Persian grounded behavior, current-request citation authority, mode-only output formatting, ambiguity handling, sourced suggestions, destructive-command warnings, and no autonomous actions.
- [x] 9.5 In the current `docs/` repository, implement the deterministic insufficient-context path with `sources: []`, exactly `منبع کافی پیدا نشد`, no AvalAI call, and abstention metrics.
- [x] 9.6 In the current `docs/` repository, delay HTTP `200` until pre-stream checks pass, call AvalAI with the 10-second first-byte and remaining-total deadlines, and emit only normalized `meta`, `sources`, `delta`, optional `suggestions`, and one terminal `done` event in order.
- [x] 9.7 In the current `docs/` repository, map pre-stream failures to sanitized `400`, `413`, `429`, `502`, `503`, or `504` responses and post-commit failures to one terminal `error` event with no following `done`; emit only `: ping` if a heartbeat is required.
- [x] 9.8 In the current `docs/` repository, propagate Stop, socket close, timeout, shutdown, parser failure, and output-limit aborts to active engine/AvalAI work, stop retries and writes, release concurrency in `finally`, and record canonical cancelled/timeout outcomes.
- [x] 9.9 In the current `docs/` repository, persist safe metrics best-effort after policy decisions and log only redacted metric-write failures without changing or extending the user stream.

## 10. Phase D - Production UI Transport and End-to-End Gate

- [x] 10.1 In the current `docs/` repository, implement the production transport with one `AbortController` per request, incremental normalized SSE parsing, malformed-order/EOF detection, Stop/teardown cancellation, and new-request Retry behind the frozen Phase A interface.
- [x] 10.2 In the current `docs/` repository, select the real transport explicitly on public production routes and add tests proving neither network failure nor a build-time demo flag can fall back to mock.
- [x] 10.3 Across the current `docs/` repository and `../deepdocsengine`, add end-to-end tests for all pre-stream statuses, `Retry-After`, database fail-closed behavior, engine/provider failures, provider `429`/`5xx`, malformed SSE, arbitrary chunk boundaries, frame/output/source/context/token caps, and no retry after first byte.
- [x] 10.4 Across the current `docs/` repository and `../deepdocsengine`, test timeout and cancellation at validation/admission, retrieval, provider startup, and streaming stages, including browser disconnect propagation, exactly one terminal event when writable, and slot release on every outcome.
- [x] 10.5 In the current `docs/` repository, test exact zero-call abstention, Prompt v1 injection resistance, current-request citation allowlisting, unknown-citation inertness, supported suggestions/workflows, multi-turn lengths 1/5/10, stale assistant claims, and over-limit history rejection.
- [ ] 10.6 In the current `docs/` repository, run the full versioned end-to-end evaluation and retain two-reviewer correctness, claim-support annotations, URL/anchor/citation checks, ambiguity/workflow results, security review, accessibility evidence, and privacy capture inspection. Automated pass complete against a real local stack (real AvalAI, real ingested corpus): `openspec/changes/add-ai-docs-assistant/evidence/phase-d-e2e-evaluation.json` — 31/31 cases, URL/anchor/citation validity 100%, abstention precision 100%, 2 cases hit the 45s deadline as designed. Two-reviewer human correctness scoring still pending.
- [ ] 10.7 Across the current `docs/` repository and `../deepdocsengine`, run the documented load and fault profile and verify p95 config/rate below 150 ms, retrieval below 1 second, first token below 3 seconds, typical completion below 20 seconds, the 45-second hard deadline, Qdrant restart/rollback, and required alerts.
- [ ] 10.8 Phase D gate: across the current `docs/` repository and `../deepdocsengine`, require all status/disconnect tests, recall@5 at least 80 percent, URL/anchor validity 100 percent, citation and claim support at least 98 percent, two-reviewer correctness at least 90 percent, abstention precision at least 95 percent, zero fabricated clickable citations, and no unresolved high or critical security finding.
- [x] 10.9 In `../deepdocsengine`, remove `/query` and engine-owned completion only after Phase D `/retrieve` parity and current `docs/` completion tests pass, then rerun private-route and readiness tests.

## 11. Phase E - Ordered Liara Deployment

- [x] 11.1 In the current `docs/` repository, define secret-safe standalone build and one-shot migration deployment configuration with required environment validation, explicit Liara-approved `TRUSTED_CLIENT_IP_HEADER`, no secret Docker `ARG` or `NEXT_PUBLIC_*` value, and build-context exclusions for `.env`, `.git`, `.next`, and `node_modules`.
- [ ] 11.2 In `../deepdocsengine`, define the private Liara engine, persistent Qdrant volume, non-mock embedding configuration, one-shot ingestion job, private document-writing access, and required environment/readiness validation without public Qdrant exposure.
- [ ] 11.3 In the current `docs/` repository, run the additive PostgreSQL migration as a one-shot job and retain redacted migration output before deploying dependent services.
- [ ] 11.4 In `../deepdocsengine`, provision private persistent Qdrant, deploy the authenticated engine with token overlap if needed, and verify external network denial plus distinct process/Qdrant/alias readiness.
- [ ] 11.5 Across the current `docs/` corpus artifact and `../deepdocsengine`, run one-shot ingestion into a new physical collection, verify the manifest and points, execute retrieval evaluation, retain the prior target, and atomically switch the alias only after Phase B gates pass.
- [ ] 11.6 In the current `docs/` repository, deploy standalone Next.js with the real transport and database-backed `assistantEnabled=false`, then verify public requests receive the controlled disabled response with no mock fallback.
- [ ] 11.7 Across the current `docs/` repository and `../deepdocsengine`, smoke-test masked admin configuration, allowlisted AvalAI connection, atomic quotas, `/api/docs-query`, streaming, abort, dependency readiness, privacy capture, token/cost measurement, and feature disablement using the production corpus.
- [ ] 11.8 Phase E deployment gate: retain redacted Liara configuration, private-network/firewall proof, volume attachment, one-shot job logs, collection manifest, evaluation report, alias-switch record, build scan, smoke records, and restart evidence proving persistence and no unintended migration or reindex.

## 12. Phase E - Progressive Rollout and Rollback Gates

- [ ] 12.1 In the current `docs/` repository, record the measured cost-per-successful-grounded-answer baseline and approved environment-specific threshold before any 10-percent rollout.
- [ ] 12.2 Across the current `docs/` repository and `../deepdocsengine`, enable internal traffic only after current quality, security, accessibility, reliability, readiness, privacy, latency, quota, cancellation, and cost evidence passes; test immediate `assistantEnabled=false` rollback.
- [ ] 12.3 Across the current `docs/` repository and `../deepdocsengine`, advance to 10 percent only while internal gates remain healthy, retain stage metrics/evaluation evidence, and retest flag, application, engine-token, and Qdrant-alias rollback paths.
- [ ] 12.4 Across the current `docs/` repository and `../deepdocsengine`, advance to 50 percent only while quality/performance gates and the approved grounded-answer cost threshold remain healthy, then test `assistantEnabled=false` rollback again.
- [ ] 12.5 Across the current `docs/` repository and `../deepdocsengine`, advance to 100 percent only with current two-reviewer, automated citation/anchor, security, accessibility, load, alert, ingestion/evaluation, readiness, and cost evidence, then test `assistantEnabled=false` rollback again.
- [ ] 12.6 Phase E rollout gate: in the current `docs/` repository, verify every stage blocked advancement on any unhealthy required signal and that disabling the persisted flag stopped new requests within 30 seconds without deployment, mock output, uncited output, or loss of rollback state.

## 13. Final Evidence and Cleanup

- [ ] 13.1 Across the current `docs/` repository and `../deepdocsengine`, assemble the final version-bound scorecard for corpus, collection, embedding, chunker, retrieval threshold, Prompt v1, completion model, budgets, dataset, reviewers, security, accessibility, load, alerts, privacy, cost, and rollout stages.
- [ ] 13.2 In the current `docs/` repository, reconcile sampled provider usage with daily/model/status/grounded-success cost reports and verify abstentions remain separate, zero-call, and excluded from grounded-success cost calculations.
- [ ] 13.3 Across the current `docs/` repository and `../deepdocsengine`, run final secret/prohibited-content scans over browser captures, database rows, logs, metrics, audits, caches, container configuration, and release evidence, resolving any high or critical finding before sign-off.
- [ ] 13.4 In `../deepdocsengine`, after the explicit retention window, remove only obsolete inactive Qdrant collections while retaining the required rollback target and evidence; never clean up as part of alias promotion.
- [ ] 13.5 Across the current `docs/` repository and `../deepdocsengine`, retire old engine and encryption keys only after current-key readiness and decrypt-new verification, while leaving additive database objects and `/api/chat` removal to separate confirmed-non-use changes.
- [ ] 13.6 Final gate: across the current `docs/` repository and `../deepdocsengine`, rerun repository tests/builds and strict OpenSpec validation, confirm every Definition of Done and release gate has attributable evidence, and record any intentionally deferred out-of-MVP work without marking it implemented.
