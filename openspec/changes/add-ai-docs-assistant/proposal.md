## Why

Liara documentation currently has a mock assistant and a broad AvalAI proxy, but it has no production path that can answer from trusted documentation sources with enforceable citations, bounded cost, multi-replica limits, or safe operational controls. This change turns the existing prototype into a measurable, production-ready Persian documentation assistant while preserving the separate Rust retrieval-engine boundary.

## What Changes

- Add the public `POST /api/docs-query` contract with strict validation and normalized SSE events for metadata, sources, deltas, suggestions, completion, and terminal stream errors.
- Add retrieval-only `POST /retrieve` behavior to the Rust engine, secure all non-health engine routes with bearer authentication, remove permissive CORS, and retire the engine-owned LLM path after parity.
- Build a reproducible documentation corpus and trusted URL/anchor manifest, use independent dense and lexical retrieval, and deploy versioned Qdrant collections through an active alias.
- Move AvalAI access into a shared server helper, enforce an allowlisted model/base URL, propagate deadlines and aborts, and harden the compatibility `/api/chat` endpoint.
- Connect the existing assistant UI to the real transport without changing its component model; preserve streaming, modes, Stop/Retry, citations, follow-up suggestions, responsive behavior, accessibility, and safe rendering.
- Add PostgreSQL-backed atomic rate limits, concurrency control, runtime enablement, admin settings, connection testing, privacy-preserving metrics, audit metadata, readiness, and operational dashboards.
- Add versioned quality, security, accessibility, performance, cost, and retrieval evaluation gates with deterministic abstention when context is insufficient.
- Add Liara deployment requirements for private engine/Qdrant networking, persistent Qdrant storage, one-shot migration/ingestion jobs, progressive rollout, and flag-based rollback.
- **BREAKING**: Private engine routes require `Authorization: Bearer <ENGINE_API_TOKEN>`; permissive browser CORS is removed.
- **BREAKING**: The assistant browser contract is `/api/docs-query`; provider-controlled fields such as `model`, `system`, tools, and arbitrary stream options are rejected.
- **BREAKING**: Engine completion through `/query` is removed after retrieval parity, leaving Next.js as the only LLM completion owner.

## Capabilities

### New Capabilities

- `assistant-query-orchestration`: Browser request validation, retrieval-to-completion orchestration, grounded prompt rules, normalized SSE, failures, and abort propagation.
- `docs-retrieval-corpus`: Authenticated retrieval-only engine behavior, trusted source metadata, hybrid retrieval, safe ingestion, collection versioning, and readiness.
- `assistant-user-experience`: Assistant modes, streaming conversation behavior, citations, suggestions, storage, responsive layouts, accessibility, and renderer safety.
- `assistant-administration`: Runtime configuration, encrypted AvalAI settings, admin connection tests, audit events, and monitoring dashboards.
- `assistant-operational-controls`: Rate limiting, concurrency, secret handling, SSRF protection, privacy, timeouts, retries, observability, and cost controls.
- `assistant-quality-evaluation`: Versioned evaluation datasets and release gates for retrieval, grounding, correctness, abstention, multi-turn behavior, security, accessibility, and cost.
- `liara-assistant-deployment`: Private multi-service Liara topology, persistent storage, release jobs, configuration, health checks, rollout, and rollback.

### Modified Capabilities

None. This repository has no existing OpenSpec capability baseline.

## Impact

- Docs repository: `src/pages/api/docs-query.js`, `src/pages/api/chat.js`, shared server helpers, assistant transport/contract/UI, Prisma schema and migrations, admin Settings/Dashboard, tests, corpus generation, environment documentation, and container configuration.
- Engine repository: `../deepdocsengine` routing, authentication, provider separation, retrieval/ranking, metadata, ingestion, Qdrant lifecycle, health/readiness, tests, and deployment configuration.
- External systems: PostgreSQL, AvalAI, embedding provider, Qdrant, and Liara private networking/persistent volumes/release jobs.
- Operations: new secrets and runtime settings, quality datasets, dashboards/alerts, collection aliases, progressive rollout, and rollback procedures.
- Out of scope: user login, persisted/replayed conversations, profile-based personalization, autonomous side effects, a second vector database, voice, and complete command execution workflows.
