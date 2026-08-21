## Purpose

Define secure runtime administration, connection testing, audit evidence, and privacy-preserving operational visibility for the assistant.

## ADDED Requirements

### Requirement: Runtime assistant configuration
Authenticated administrators SHALL be able to view and update the allowlisted AvalAI base URL, default model, assistant enable switch, and per-minute and per-day assistant limits. The assistant MUST default to disabled and disabling it MUST stop new assistant requests without deployment. Limits MUST have bounded range validation, and `0` MUST NOT mean unlimited. The production feature state MUST come from persisted runtime configuration; `NEXT_PUBLIC_ASSISTANT_DEMO` or any build-time mock flag MUST NOT enable the production assistant on public routes. Configuration changes, including key rotation, MUST take effect within at most 30 seconds.

#### Scenario: Administrator disables the assistant
- **WHEN** an authenticated administrator saves `assistantEnabled=false`
- **THEN** new public assistant requests receive the controlled disabled response without requiring a deployment

#### Scenario: Administrator enters a zero limit
- **WHEN** an administrator attempts to save `0` as a minute or day limit
- **THEN** validation rejects it rather than interpreting it as unlimited access

### Requirement: Secret and provider configuration safety
The AvalAI key MUST remain write-only and masked in administration responses and MUST be stored only encrypted in PostgreSQL with versioned encryption-key rotation. The base URL MUST use HTTPS and an allowlisted host, and the default model MUST be allowlisted. AvalAI and engine credentials MUST remain separate and independently rotatable; no secret MUST appear in a `NEXT_PUBLIC_*` value, browser response, log, audit event, metric, or Docker build argument. An administrator MUST NOT be able to configure an arbitrary base URL that enables SSRF.

#### Scenario: Administrator reads settings after saving a key
- **WHEN** settings are loaded after an AvalAI key has been configured
- **THEN** the response shows only a masked/write-only key state and never returns the stored key

#### Scenario: Administrator supplies a non-allowlisted endpoint
- **WHEN** an administrator attempts to save a non-HTTPS or non-allowlisted AvalAI base URL or a non-allowlisted model
- **THEN** the system rejects the configuration and does not contact that endpoint

### Requirement: Isolated connection testing
Authenticated administrators SHALL have a Test connection action that runs one short server-side completion against only the allowlisted configured host and model. A test MUST use a separate small quota, MUST NOT return the key, and MUST NOT commit pending configuration changes. Test prompts and provider response content MUST NOT be recorded in audit or operational storage.

#### Scenario: Connection test succeeds
- **WHEN** an authenticated administrator tests an allowlisted host and model with valid server-side credentials
- **THEN** the system reports success without returning the key or committing configuration edits

#### Scenario: Connection-test quota is exhausted
- **WHEN** an administrator invokes Test connection after its separate quota is exhausted
- **THEN** the system rejects the test without consuming public assistant quota or contacting the provider

### Requirement: Privacy-safe administrative audit
The system MUST audit configuration saves and connection tests with `eventType`, administrator ID, success, timestamp, and only allowlisted metadata. Audit retention MUST be explicitly defined. If IP metadata is retained, it MUST be HMACed and never stored raw. Audit records MUST NOT contain secrets, authorization values, prompts, history, answers, source text, or raw IP/session identifiers.

#### Scenario: Configuration save is audited
- **WHEN** an administrator successfully or unsuccessfully saves assistant configuration
- **THEN** an audit event records the event type, administrator ID, outcome, timestamp, and allowlisted metadata without prohibited content

### Requirement: Privacy-preserving request metrics
Operational metrics MUST distinguish `chat` from `docs_assistant` requests and MUST include `requestId`, provider request ID when available, model, provider-reported input/output token usage, estimated cost, and request status without conversation content. They MUST separately record configuration/rate, retrieval, first-byte, and total latency and use only `ok`, `error`, `timeout`, or `cancelled` status categories. Raw IP/session values MUST NOT be stored; any correlating values MUST use HMAC with an independent server secret and periodic rotation.

#### Scenario: Assistant request completes
- **WHEN** a docs assistant request reaches a terminal outcome
- **THEN** metrics identify it as `docs_assistant` and record safe IDs, status, usage/cost, and separate latency stages without prompt, answer, history, or source text

#### Scenario: HMAC identifiers rotate
- **WHEN** the configured identifier-rotation period elapses
- **THEN** newly recorded metrics use rotated HMAC identifiers without retaining raw IP or session values

### Requirement: Administrative dashboard visibility
Without displaying conversation text, the dashboard SHALL show request, success, error, timeout, cancelled, and `429` counts split by `chat` and `docs_assistant`; p50 and p95 retrieval, first-token, and total latency; daily tokens and estimated cost; empty-retrieval/abstention rate; average source count; latest engine, Qdrant, and AvalAI-configuration readiness; and latest ingestion and evaluation status. It MUST support filters by time range, model, and status. Request drill-down MUST expose only safe metadata for the same `requestId`.

#### Scenario: Administrator investigates a failed request
- **WHEN** an administrator filters by status and opens a request drill-down
- **THEN** the dashboard shows only safe metadata associated with that request ID and no conversation or source content

#### Scenario: Administrator reviews system readiness
- **WHEN** the administrator opens operational readiness information
- **THEN** engine, Qdrant, and AvalAI configuration readiness are shown separately with latest ingestion and evaluation status

### Requirement: Cost and grounded-success reporting
The dashboard MUST report abstentions separately from successful grounded answers. `cost per successful grounded answer` MUST equal total assistant provider cost divided by responses with status `ok`, at least one valid source, valid citations, and no evaluation or monitoring failure marker. The system MUST NOT classify an abstention as a grounded answer. Before 10-percent rollout, administration MUST record a baseline and approved release threshold for this measure; progression to 50 and 100 percent MUST remain within that threshold while quality and performance gates remain healthy.

#### Scenario: Cost metric includes an abstention
- **WHEN** a request returns the deterministic no-source response without calling AvalAI
- **THEN** the dashboard counts it as an abstention and excludes it from successful grounded answers

#### Scenario: Rollout exceeds approved cost threshold
- **WHEN** measured cost per successful grounded answer exceeds the approved rollout threshold
- **THEN** administration does not advance the rollout to the next stage
