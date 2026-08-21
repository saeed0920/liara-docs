## Purpose

Define enforceable runtime controls that keep the assistant secure, private, bounded, observable, reliable, and cost-accountable under normal use and failure conditions.

## ADDED Requirements

### Requirement: Atomic multi-replica request limits
The assistant SHALL enforce configurable per-minute and per-day limits in aligned UTC windows for both HMAC(IP) and HMAC(session), consuming all four checks atomically before retrieval. The default limits SHALL be 10 requests per minute and 100 requests per day, configured values MUST pass bounded range validation, and zero MUST NOT mean unlimited. A rejected transaction MUST consume none of the other buckets, and a limit response SHALL be HTTP `429` with `Retry-After` equal to the remaining window duration. The session UUID SHALL be treated only as a rate-limit hint, and client IP SHALL be read only from the explicitly configured trusted Liara client-IP header.

#### Scenario: One bucket rejects an otherwise valid request
- **WHEN** any IP or session minute or day bucket has reached its configured limit
- **THEN** the assistant returns `429` with the correct `Retry-After`, performs no retrieval or completion, and rolls back increments to all four buckets

#### Scenario: Database is unavailable during limit consumption
- **WHEN** the assistant cannot atomically evaluate the four request buckets
- **THEN** it fails closed with `503` and does not contact the retrieval engine or completion provider

#### Scenario: Concurrent replicas consume the same final allowance
- **WHEN** two application replicas concurrently attempt to consume the last allowance for the same HMAC-derived subject and window
- **THEN** no more than one request is admitted and the other request receives `429`

### Requirement: Independent concurrency control
The assistant MUST enforce a configurable global concurrency limit per application replica independently of minute and day quotas. Every acquired slot MUST be released after success, error, timeout, or client disconnect so abandoned requests cannot exhaust capacity.

#### Scenario: Client disconnect releases capacity
- **WHEN** a client disconnects while a request holds a concurrency slot
- **THEN** the assistant aborts upstream work and releases the slot for a subsequent request

### Requirement: Bounded untrusted input and generated output
The public assistant route MUST limit request bodies to `32KB`, trimmed messages to 1 through 2,000 characters, history to 10 user/assistant messages and 12,000 characters, and page titles to 200 trimmed characters. It MUST accept only UUID session IDs, the `normal`, `tutorial`, and `command` modes, and internal non-traversing page paths, and MUST reject unknown fields and browser-supplied model, system, provider, tool, or stream configuration. Completion context MUST contain no more than 5 allowlisted sources and 12,000 characters, initial generated output MUST be capped at 800 tokens, and provider SSE parsing MUST enforce fixed per-frame and total-output bounds.

#### Scenario: Oversized request is rejected before upstream work
- **WHEN** a request body exceeds `32KB` or its history exceeds either supported history limit
- **THEN** the assistant returns `413` without performing retrieval or completion

#### Scenario: Provider-controlled field is submitted
- **WHEN** a browser request contains a model, system instruction, tool, stream option, provider payload, unknown field, full page URL, protocol, or traversal path
- **THEN** the assistant returns `400` and does not pass the rejected value upstream

#### Scenario: Retrieved and generated content approaches its budget
- **WHEN** retrieval returns more context or sources than allowed or completion reaches the initial output budget
- **THEN** the assistant uses at most 5 sources and 12,000 context characters and stops generation at no more than 800 output tokens with a bounded finish reason

### Requirement: Secret isolation and endpoint trust controls
The AvalAI key and retrieval-engine token MUST be separate, independently rotatable secrets and MUST be available only to server-side components through environment variables or encrypted database fields. No secret SHALL use a `NEXT_PUBLIC_*` variable or reach the browser. AvalAI base URLs MUST use HTTPS and an allowlisted host, browser origin and host MUST be validated, and arbitrary forwarded client-IP headers MUST NOT be trusted. Engine token rotation SHALL support a short current/next overlap, and encryption-key rotation SHALL support versioned decrypt-old/encrypt-new behavior.

#### Scenario: Unapproved provider destination is configured
- **WHEN** an administrator or compatibility request supplies a non-HTTPS or non-allowlisted AvalAI base URL or an unallowlisted model
- **THEN** the server rejects the destination or model without making an outbound request

#### Scenario: Secrets are rotated
- **WHEN** operators rotate the engine token or database encryption key
- **THEN** the documented overlap or key-version mechanism preserves authorized service while old credentials can be retired independently

### Requirement: Prompt and rendering security boundaries
Source text MUST be treated as untrusted data inside explicit delimiters and MUST NOT alter server instructions. Modes MUST change only response form, and no command, URL, technical fact, or suggestion SHALL be generated without source support. The assistant renderer MUST execute no raw HTML, MUST use React escaping or `textContent` for streamed text, MUST restrict Markdown and internal routes, and MUST apply `noopener noreferrer` to external links. Citation IDs not present in the current request's source event MUST remain unlinked text.

#### Scenario: Retrieved documentation contains prompt injection
- **WHEN** source content instructs the assistant to ignore its system rules, expose secrets, or perform an action
- **THEN** the content remains data, the instruction is not followed, and the response remains bounded to supported documentation claims

#### Scenario: Stream contains executable markup or an unknown citation
- **WHEN** generated content contains raw HTML, script-like markup, an unsafe link, or a citation ID absent from the request sources
- **THEN** the UI does not execute the markup or create an unsafe or fabricated citation link

### Requirement: Privacy-preserving storage, logs, and audit
The system MUST NOT persist, log, or cache prompts, history, answers, source text, raw source bodies, raw IP/session values, authorization headers, or secrets. Stored subject identifiers MUST be produced with a dedicated rotatable HMAC secret independent of `SESSION_SECRET`. Configuration saves and connection tests SHALL create retained audit metadata containing only event type, administrator ID, success, timestamp, HMACed IP, and explicitly allowlisted metadata; the AvalAI key SHALL remain write-only and masked. Personalization MUST be limited to current page context, selected mode, and bounded session history, with no inferred identity or persisted profile.

#### Scenario: Operational records are inspected
- **WHEN** database rows, logs, metric records, audit events, and cache entries for an assistant request are examined
- **THEN** none contains prohibited conversation content, raw source content, raw IP/session values, authorization data, or secrets

#### Scenario: Administrator tests a connection
- **WHEN** an administrator runs a connection test
- **THEN** the server applies a separate small quota, tests only an allowlisted host and model with a short completion, commits no configuration change, returns no key, and records only safe audit metadata

### Requirement: Deadline, abort, retry, and failure behavior
The assistant MUST enforce an explicit request deadline with retrieval limited to 3 seconds, AvalAI limited to 10 seconds to first byte, and the entire request limited to 45 seconds, propagating the remaining deadline and client abort signal upstream. It MAY retry at most twice with jitter only for provider `429` or `5xx` responses and only before the first response byte. Before streaming begins, invalid input, excessive input, rate limiting, unavailable configuration, upstream failure, and timeout SHALL map respectively to `400`, `413`, `429`, `503`, `502`, and `504`; error bodies MUST expose only a public code and request ID. After streaming starts, failure MUST produce one terminal `error` event and close the stream rather than changing HTTP status or emitting `done`.

#### Scenario: Provider fails before streaming
- **WHEN** AvalAI returns a retryable `429` or `5xx` before any response byte
- **THEN** the assistant makes no more than two jittered retries within the remaining deadline and returns a sanitized mapped failure if all attempts fail

#### Scenario: Provider fails after partial output
- **WHEN** malformed SSE, an upstream error, or a timeout occurs after the first response byte
- **THEN** the assistant performs no retry, emits one terminal sanitized `error` event with request ID and retryability, and closes the stream without `done`

#### Scenario: Browser disconnects during upstream work
- **WHEN** the browser aborts before or during streaming
- **THEN** the assistant propagates cancellation to retrieval and completion and records the request as `cancelled`

### Requirement: Controlled degradation and configuration freshness
Production MUST return a controlled disabled or failure response when dependencies are unavailable and MUST NOT fall back to mock transport or an uncited response. Non-conversation configuration MAY be cached only for a bounded interval that makes key rotation effective within 30 seconds. Metrics recording failure MUST NOT break an otherwise valid user response, but MUST be visible in operational logs.

#### Scenario: Assistant is disabled or provider is unconfigured
- **WHEN** runtime configuration disables the assistant or lacks valid AvalAI configuration
- **THEN** new public assistant requests return sanitized `503` responses and no mock, retrieval, or completion path is used

#### Scenario: Encryption or provider key changes
- **WHEN** an administrator rotates a key while application replicas are running
- **THEN** every replica observes the new usable configuration within 30 seconds without caching conversation or retrieval content

### Requirement: Privacy-preserving operational monitoring
Metrics MUST distinguish `chat` from `docs_assistant` and record request ID, provider request ID, model, safe status, provider-reported input/output tokens, estimated cost, source count, and separate configuration/rate, retrieval, first-byte, and total latencies without conversation content. Statuses MUST distinguish `ok`, `error`, `timeout`, and `cancelled`. Dashboards SHALL expose request, success, error, timeout, cancellation, and `429` counts; p50/p95 retrieval, first-token, and total latency; daily tokens and cost; empty-retrieval/abstention rate; average source count; and latest engine, Qdrant, AvalAI configuration, ingestion, and evaluation status, filterable by time, model, and status with safe request-ID drill-down. Alerts MUST cover error rate, `429`, p95 latency, daily tokens/cost, and ingestion failure.

#### Scenario: Operator investigates degraded service
- **WHEN** error rate, `429` count, p95 latency, daily token/cost, or ingestion state crosses its configured alert condition
- **THEN** an alert fires and the dashboard provides the required aggregate and safe request metadata without displaying conversation text

#### Scenario: Readiness dependencies diverge
- **WHEN** the engine process is reachable but Qdrant, the active collection, or AvalAI configuration is not ready
- **THEN** monitoring reports each dependency's readiness separately rather than reporting a single healthy assistant state

### Requirement: Measured performance and cost controls
Under the documented load profile, p95 configuration/rate latency MUST be below 150 ms, p95 retrieval MUST be below 1 second, p95 end-to-end first token MUST be below 3 seconds, and a typical complete response MUST be below 20 seconds while retaining the 45-second hard deadline. The system SHALL define `cost per successful grounded answer` as total assistant provider cost divided by `ok` responses having at least one valid source, valid citations, and no evaluation or monitoring failure marker; abstentions MUST be reported separately. No completion request SHALL be made for insufficient context, and no cross-request or cross-user response/source cache SHALL be used.

#### Scenario: Insufficient context avoids completion cost
- **WHEN** retrieval reports insufficient context
- **THEN** the assistant makes zero AvalAI completion calls, returns exactly `منبع کافی پیدا نشد` with no sources, and records the result as an abstention rather than a grounded answer

#### Scenario: Cost efficiency is reported
- **WHEN** operators view cost metrics for a day, model, or status
- **THEN** provider usage and estimated cost are shown with the defined grounded-success classification and abstentions are excluded from its denominator
