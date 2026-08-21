## Purpose

Define the secure Liara production topology, release ordering, readiness, progressive enablement, and reversible data and application rollout for the assistant.

## ADDED Requirements

### Requirement: Separate private production topology
Production MUST deploy the Next.js standalone documentation application, Rust retrieval engine, and persistent Qdrant as separate components. The engine and Qdrant MUST use Liara-approved private connectivity or an internal firewall, Qdrant MUST have a persistent volume, and the Qdrant port and document-writing endpoints MUST NOT be exposed on a public host. The browser SHALL call only the documentation application's `POST /api/docs-query`; all non-health engine endpoints MUST require the engine bearer token, and engine CORS MUST NOT permit browser access.

#### Scenario: Public network exposure is tested
- **WHEN** an external client attempts to reach Qdrant or an engine private endpoint without the configured bearer token
- **THEN** Qdrant is unreachable and the engine rejects the request while public health remains available

#### Scenario: Qdrant restarts
- **WHEN** the Qdrant component restarts during a persistence test
- **THEN** the active collection remains available from its persistent volume without an unintended reindex

### Requirement: Deployment configuration and secret-safe build
The documentation application MUST receive `DATABASE_URL`, `ENCRYPTION_SECRET`, `SESSION_SECRET`, `ASSISTANT_HMAC_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DOCS_ENGINE_URL`, `DOCS_ENGINE_TOKEN`, `AVALAI_ALLOWED_HOSTS`, `ASSISTANT_REQUEST_TIMEOUT_MS`, `ASSISTANT_MAX_CONCURRENCY`, and an explicit Liara-approved `TRUSTED_CLIENT_IP_HEADER`. The engine MUST receive `HOST`, `PORT`, `DOCS_DIR`, `QDRANT_URL`, `QDRANT_COLLECTION`, `QDRANT_ALIAS`, `VECTOR_SIZE`, `ENGINE_API_TOKEN`, `ENGINE_PROVIDER`, `ENGINE_HTTP_TIMEOUT_MS`, `CORPUS_MANIFEST`, and embedding-provider credentials. Production MUST forbid `ENGINE_PROVIDER=mock`. Secrets MUST NOT be passed as Docker `ARG`, stored in public variables, or included in build context, and the production image/context MUST exclude `.env`, `.git`, `.next`, and `node_modules`.

#### Scenario: Production artifact is inspected
- **WHEN** the container build configuration, context, image, and public environment are scanned
- **THEN** no Docker `ARG` secret, `.env`, `.git`, `.next`, `node_modules`, or `NEXT_PUBLIC_*` secret exposure is present

#### Scenario: Required provider configuration is unsafe
- **WHEN** production selects the mock engine provider or omits the approved trusted client-IP header
- **THEN** deployment readiness fails and the assistant remains disabled

### Requirement: One-shot migration and ingestion jobs
PostgreSQL migration and corpus ingestion MUST run as one-shot release jobs and MUST NOT run as startup work for every application or query-service replica. Ingestion MUST use the same build's versioned corpus and URL/anchor manifest. A missing or empty corpus, manifest mismatch, or embedding dimension mismatch MUST fail before any stale deletion, alias switch, or mutation of the active collection.

#### Scenario: A replica restarts after deployment
- **WHEN** a Next.js or engine query replica starts or restarts
- **THEN** it does not run the PostgreSQL migration or a full corpus reindex as replica startup work

#### Scenario: Ingestion input is invalid
- **WHEN** the corpus is empty, its manifest does not match, or vector dimensions are incompatible
- **THEN** ingestion fails without deleting documents, changing the active collection, or moving its alias

### Requirement: Versioned collection replacement and data rollback
Every collection manifest MUST identify embedding provider, model, dimension, chunker version, corpus commit, and timestamp. Hash skipping SHALL apply only within the same compatible manifest version. An embedding model, vector dimension, or chunker change MUST create and fully reindex a newly versioned collection; replacement MUST NOT delete-then-upsert the active collection. The new collection MUST be ingested and evaluated before an atomic active-alias switch, and the previous alias target MUST be retained for rollback.

#### Scenario: Embedding compatibility changes
- **WHEN** the embedding model, output dimension, or chunker version changes
- **THEN** deployment creates and evaluates a new collection rather than changing the active collection in place

#### Scenario: New collection fails after alias switch
- **WHEN** production validation detects a collection-specific regression after activation
- **THEN** operators can atomically restore the retained previous alias target without rebuilding it

### Requirement: Ordered production release
Deployment MUST proceed in this order: PostgreSQL migration; Qdrant with persistent volume; engine deployment and ingestion into a new collection; retrieval evaluation; atomic Qdrant alias switch after evaluation gates pass; Next.js deployment with the assistant disabled; admin, AvalAI, and proxy smoke tests; then progressive enablement. A failed stage MUST block every dependent later stage, and the active collection MUST never be switched before retrieval evaluation passes.

#### Scenario: Retrieval evaluation misses its gate
- **WHEN** the newly ingested collection fails recall, source URL, anchor, security, or other required evaluation gates
- **THEN** its alias is not made active and Next.js remains deployed or deployable only with the assistant disabled

### Requirement: Dependency-specific health and release evidence
Deployment readiness MUST report engine process health, Qdrant connectivity, active collection existence, and AvalAI configuration separately. Release evidence MUST include redacted Liara configuration, private-network or firewall proof, persistent-volume attachment, one-shot job logs, collection manifest, evaluation report, alias-switch record, and smoke-test records for admin configuration, AvalAI connection, `/api/docs-query`, engine readiness, Qdrant readiness, feature disablement, and rollback. Restart evidence MUST demonstrate persistence and key/config refresh without unintended reindex.

#### Scenario: One dependency is not ready
- **WHEN** engine health succeeds but Qdrant connectivity, active collection existence, or AvalAI configuration fails
- **THEN** readiness identifies the failing dependency and progressive enablement is blocked

### Requirement: Disabled-by-default progressive rollout
Production MUST start with the database-backed `assistantEnabled=false`; a public build-time demo flag MUST NOT enable production assistant or mock behavior. After preview smoke testing with the production corpus, security review, and load testing pass, rollout MAY advance only through internal, 10%, 50%, and 100% stages. Advancement MUST require healthy quality, error, latency, rate-limit, security, readiness, and cost gates at the current stage.

#### Scenario: Production is deployed before smoke tests
- **WHEN** the new Next.js release starts in production
- **THEN** the assistant is disabled, new assistant requests receive the controlled disabled response, and no mock fallback is exposed

#### Scenario: A rollout gate degrades
- **WHEN** any required quality, error, latency, rate-limit, security, readiness, or cost metric becomes unhealthy at a rollout stage
- **THEN** rollout does not advance and the assistant is held or rolled back

### Requirement: Runtime flag rollback at every stage
Setting `assistantEnabled=false` MUST stop admission of new assistant requests without a deployment while allowing operators to preserve the deployed application and previously active collection for diagnosis. Flag-based rollback MUST be tested at internal, 10%, 50%, and 100% rollout stages. Collection rollback through the retained alias and application rollback SHALL remain independently available when the runtime flag alone does not resolve a data or release regression.

#### Scenario: Operator disables a live rollout
- **WHEN** an operator sets `assistantEnabled=false` during any rollout stage
- **THEN** new assistant requests stop without redeployment and return the controlled disabled response without mock or uncited output

#### Scenario: Regression is tied to the active corpus
- **WHEN** disabling traffic identifies the new collection as the regression source
- **THEN** the retained previous alias can be restored independently before controlled re-enablement
