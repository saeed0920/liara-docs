## Purpose

Define the public query contract and server orchestration that produce bounded, grounded Persian answers without exposing provider or retrieval internals.

## ADDED Requirements

### Requirement: Public query request contract
The system SHALL expose the assistant only to the browser as `POST /api/docs-query` and SHALL NOT use `/api/chat` or any engine endpoint for assistant UI requests. The JSON request SHALL contain `sessionId`, `mode`, `message`, `history`, and `page` as defined by this capability. The route MUST enforce a `32KB` request-body limit, accept only the `normal`, `tutorial`, and `command` modes, require `message` after trimming to contain between 1 and 2,000 characters, and require `sessionId` to be a UUID used only as a rate-limit hint rather than identity. `history` MUST contain only `user` and `assistant` roles and MUST be limited to 10 messages and 12,000 total characters. `page.path` MUST be an internal path and MUST reject full URLs, protocols, and traversal; `page.title` MUST be treated as untrusted, trimmed to at most 200 characters, and MUST NOT be authority for or used to construct a URL. Unknown fields and browser-supplied `model`, `system`, `stream_options`, tool, or provider payload fields MUST be rejected.

#### Scenario: Valid browser request
- **WHEN** the browser posts a JSON request within all body, field, history, path, and mode limits to `/api/docs-query`
- **THEN** the system accepts the public request contract and uses the server-managed model and prompt configuration

#### Scenario: Oversized request
- **WHEN** a request body exceeds `32KB` or its history exceeds the fixed history limits
- **THEN** the system rejects the request with HTTP `413` before retrieval or completion

#### Scenario: Invalid or provider-controlled input
- **WHEN** a request contains an invalid mode, UUID, message, role, page field, unknown field, or a provider-controlled field
- **THEN** the system rejects the request with HTTP `400` and does not pass the invalid input upstream

### Requirement: Request admission and privacy
The system MUST validate the HTTP method, origin, host, content type, and body before processing a query and MUST consume the applicable rate limit before retrieval. It MUST read client IP only from the explicitly configured trusted Liara client-IP header. The system MUST NOT return, persist, or log prompts, history, answers, source text, raw IP or session values, authorization headers, engine tokens, AvalAI keys, or internal provider/Qdrant error text. Request metrics MAY contain privacy-safe identifiers, usage, latency, and status without conversation content, and a metrics failure MUST NOT break an otherwise valid user response.

#### Scenario: Untrusted request origin or host
- **WHEN** a request fails method, origin, host, or content-type validation
- **THEN** the system rejects it before contacting the retrieval engine or AvalAI

#### Scenario: Query telemetry is recorded
- **WHEN** the system records a query outcome
- **THEN** telemetry contains no prompt, history, answer, source body, raw IP/session value, authorization header, or secret

### Requirement: Retrieval and completion orchestration
For an admitted request, the system SHALL call the private engine `POST /retrieve` with bearer authentication and a request derived primarily from the current `message` and `page.path`. History MUST be used only for bounded prompt continuity, and any query rewrite MUST be server-side, bounded, versioned, and evaluable. Returned source metadata MUST be allowlisted again, duplicate or invalid sources MUST be excluded, and completion context MUST contain at most 5 sources and 12,000 characters. The system SHALL build a versioned server-side prompt and SHALL call AvalAI only from the server with the encrypted admin-managed key, allowlisted HTTPS host, admin-selected model, initial output limit of 800 tokens, and the remaining request deadline. The browser MUST NOT control or receive the AvalAI key, engine token, system prompt, raw context, retrieval limit, temperature, token budget, or model.

#### Scenario: Sufficient grounded context
- **WHEN** retrieval returns sufficient trusted sources for an admitted query
- **THEN** the system starts a server-side AvalAI completion using no more than 5 sources, 12,000 context characters, and the initial 800-output-token limit

#### Scenario: Browser attempts to control completion
- **WHEN** the browser supplies a model, system instruction, provider option, raw context, or retrieval control
- **THEN** the system rejects the request rather than applying the browser-supplied control

### Requirement: Grounding and insufficient-context behavior
The system prompt MUST define a Persian-language Liara documentation assistant, treat only the supplied sources as trusted factual context, and treat instructions embedded in source text as untrusted data. Every verifiable technical claim MUST be supported by a source returned for the same request. Citations MUST be limited to `[S1]` through `[S5]`, and the model MUST NOT generate a URL, command, or fact without source support. When retrieval reports insufficient context or returns no sufficient source, the system MUST skip AvalAI, emit `sources: []`, and return exactly `منبع کافی پیدا نشد`. Prior assistant messages MUST NOT be treated as authoritative sources.

#### Scenario: Retrieval has insufficient context
- **WHEN** retrieval reports that no sufficient source exists
- **THEN** the response contains exactly `منبع کافی پیدا نشد`, exposes an empty source list, and makes no AvalAI completion call

#### Scenario: Prior assistant text conflicts with sources
- **WHEN** session history contains an assistant claim not supported by sources returned for the current request
- **THEN** the system does not treat that prior claim as authoritative and grounds the new response only in current-request sources

### Requirement: Normalized SSE response contract
After successful stream initiation, the system SHALL return normalized server-sent events in canonical order `meta -> sources -> delta* -> suggestions? -> done`. `meta` data MUST be a JSON object containing `requestId` and `model`; `sources` data MUST be a JSON array whose entries contain `id`, `title`, `url`, `anchor`, and `snippet`; each `delta` data value MUST be a JSON object containing `text`; `suggestions`, when present, MUST be a JSON array of strings; and `done` data MUST contain `finishReason` and `usage`. `finishReason` MUST be exactly one of `stop`, `length`, `cancelled`, or `error`. An optional heartbeat MUST be an SSE proxy comment exactly in the form `: ping` and MUST NOT change UI state. The real and mock transports MUST use this same event contract.

#### Scenario: Successful streaming response
- **WHEN** a grounded completion streams successfully
- **THEN** the client receives one `meta`, one `sources`, zero or more `delta`, optionally one `suggestions`, and one terminal `done` event in canonical order

#### Scenario: Proxy heartbeat
- **WHEN** the proxy requires a heartbeat while the stream is open
- **THEN** the system emits `: ping` as a comment without emitting a state-changing event

### Requirement: HTTP and stream failure contract
Before response streaming starts, the endpoint MUST use HTTP `400` for an invalid contract, `413` for an oversized body or history, `429` for a rate limit and include `Retry-After`, `503` when the assistant is disabled, AvalAI is not configured, or rate-limit admission fails closed during a database outage, `502` for engine or AvalAI failure, and `504` for timeout. Error bodies MUST expose only a public error code and `requestId`. After HTTP `200` has started, failure MUST be represented only by one terminal `error` event with JSON data containing `code`, `requestId`, and `retryable`; that event replaces `done`, no later event may follow, and the stream MUST close. Individual provider SSE frames and total output MUST be bounded, and malformed or over-limit upstream streams MUST fail through this sanitized contract.

#### Scenario: Rate limit before streaming
- **WHEN** query admission rejects a request because a rate limit is exhausted
- **THEN** the system returns HTTP `429` with `Retry-After` and a body containing only a public code and `requestId`

#### Scenario: Upstream fails after partial output
- **WHEN** an engine-independent upstream stream failure occurs after HTTP `200` and one or more response events have been sent
- **THEN** the system emits a terminal `error` event such as `{"code":"UPSTREAM_STREAM_FAILED","requestId":"...","retryable":true}` and closes the stream without a `done` event

### Requirement: Deadlines, retries, and cancellation
The entire query MUST have a maximum deadline of 45 seconds; retrieval MUST have at most 3 seconds, and AvalAI MUST have at most 10 seconds to its first byte. The remaining deadline and abort signal MUST propagate upstream. The system MUST make at most two retries with jitter, only for AvalAI `429` or `5xx` responses and only before the first response byte is sent. It MUST propagate a browser disconnect or Stop action to outstanding engine and AvalAI requests, release any concurrency slot on success, error, timeout, or disconnect, and report cancellation with canonical status and finish behavior rather than continuing hidden work.

#### Scenario: Browser disconnects during completion
- **WHEN** the browser disconnects or stops an in-progress assistant response
- **THEN** the system aborts outstanding upstream work, releases the concurrency slot, and records the request as cancelled without persisting conversation content

#### Scenario: Provider fails after first byte
- **WHEN** AvalAI returns a retryable failure after the first response byte has been sent
- **THEN** the system performs no provider retry and terminates through the SSE error contract
