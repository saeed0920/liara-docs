## Purpose

Define versioned evidence and measurable release gates for assistant retrieval, grounded response quality, safety, usability, reliability, and cost without claiming universal correctness.

## ADDED Requirements

### Requirement: Versioned representative evaluation set
Every release candidate MUST be evaluated against a versioned set of at least 30 Persian and English questions covering exact keywords, colloquial Persian, typos, page context, simple factual requests, complex synthesis, multi-turn continuity, ambiguity and follow-up, insufficient context, prompt injection, and multi-step workflows. Each applicable case MUST record tags, expected sources and anchors, required answer points, answer-versus-abstain label, expected follow-up behavior, and the prompt, model, corpus, and evaluator versions needed to reproduce regressions.

#### Scenario: Release evaluation is assembled
- **WHEN** a model, prompt, retrieval threshold, embedding, chunker, or corpus version is proposed for release
- **THEN** the complete versioned dataset is run and results remain attributable to all changed versions and required case metadata

### Requirement: Retrieval and citation release gates
The complete versioned set MUST achieve recall@5 of at least 80%, with results also reported separately for simple, complex, and multi-turn subsets. Documentation URL validity and anchor validity MUST each equal 100%, citation validity MUST be at least 98%, clickable fabricated citations MUST equal zero, and every citation identifier MUST resolve only to trusted metadata returned by the same request.

#### Scenario: Retrieval candidate is assessed for release
- **WHEN** automated retrieval and citation checks finish for the release dataset
- **THEN** release is blocked unless all aggregate, subset-reporting, URL, anchor, citation, and fabricated-citation gates are satisfied

### Requirement: Grounded answer and abstention scorecard
Claim support rate MUST be at least 98%, and every verifiable technical claim SHALL be assessed against cited sources from the same request. Two independent reviewers MUST score human answer correctness at 90% or higher with no critical security error. Abstention precision on insufficient-context cases MUST be at least 95%, all tested insufficient-context cases MUST make zero completion calls and return exactly `منبع کافی پیدا نشد` with `sources: []`, and out-of-scope responses MUST contain no fabricated technical claim.

#### Scenario: Grounded quality falls below a gate
- **WHEN** claim support, reviewer correctness, abstention precision, critical-security, no-source call, or fabricated-claim results fail a stated threshold
- **THEN** the candidate is not eligible for rollout regardless of response fluency

### Requirement: Complex, multi-turn, ambiguity, and workflow behavior
The evaluation MUST verify simple answers, synthesis across no more than 5 sources, and continuity within the 10-message and 12,000-character history boundary. All designated context-retention assertions MUST pass at history lengths 1, 5, and 10, and over-limit history MUST be rejected. All designated ambiguity cases MUST either ask the expected concise clarifying question or provide the reviewer-approved bounded answer; 100% of safety-critical ambiguity cases MUST clarify or abstain. Every evaluated technical workflow step and next-step suggestion MUST be source-supported under the aggregate claim-support gate, sourced destructive commands MUST include warnings, and no response SHALL execute or claim an autonomous side effect.

#### Scenario: Multi-turn workflow evaluation runs
- **WHEN** a case changes constraints, mode, pronoun references, or entities across prior turns and includes a stale assistant claim
- **THEN** the response retains required valid context, does not treat prior assistant text as authority, retrieves sources for each technical claim, and performs no autonomous action

#### Scenario: Material ambiguity affects safety
- **WHEN** missing information materially changes correctness, safety, or source selection in a designated safety-critical case
- **THEN** the assistant asks the expected concise clarification or abstains rather than guessing

### Requirement: Security and privacy evaluation gates
Release MUST include a security review and tests for unauthenticated engine access, removed browser CORS, SSRF and base-URL allowlists, XSS, prompt injection, unknown fields, oversized bodies and histories, secret leakage, token and encryption-key rotation, trusted client-IP handling, atomic four-bucket rollback across two processes, fail-closed database outage, upstream abort and timeout, malformed SSE, and Qdrant restart and alias rollback. A candidate MUST have no unresolved critical or high-severity finding, every private engine endpoint MUST reject missing or invalid tokens, and browser responses, databases, logs, metrics, audits, and caches MUST contain no secret or prohibited conversation content.

#### Scenario: Security evidence contains a severe finding
- **WHEN** the review identifies an unresolved high or critical vulnerability or leakage of prohibited content
- **THEN** release and rollout advancement are blocked until the finding is resolved and the affected checks pass

### Requirement: User experience and accessibility scorecard
Evaluation MUST cover the eight deterministic fixtures `success`, `slow`, `empty`, `rate-limit`, `provider-error`, `broken-stream`, `rich-content`, and `long-thread`; dark and light visual results at 360, 768, and 1440 pixels; and keyboard-only operation for `Cmd/Ctrl+I`, `Esc`, `Enter`, `Shift+Enter`, Stop, Retry, citations, and focus return. The assistant MUST have no critical or serious automated accessibility violation, all manual keyboard and focus checks MUST pass, and manual checks MUST cover screen-reader announcements, logical focus order, contrast, touch targets, zoom/reflow, and reduced motion where animation exists. There MUST be no horizontal page overflow at the required viewports, and composer, Stop, Retry, and citations MUST remain operable. XSS, storage corruption, abort, broken-stream, unknown-citation, and long-thread tests MUST pass.

#### Scenario: Required UI evidence is reviewed
- **WHEN** fixture, viewport, theme, keyboard, accessibility, and security UI checks complete
- **THEN** the candidate passes only if all stated severity, operability, overflow, focus, and deterministic-state gates are met

### Requirement: Reliability and performance evidence
Integration evidence MUST cover required HTTP statuses, `Retry-After`, cancellation, provider `429` and `5xx`, timeout, malformed SSE, browser disconnect, response frame/output limits, and terminal stream behavior. Under the documented load profile, p95 configuration/rate latency MUST be below 150 ms, p95 retrieval below 1 second, p95 first token below 3 seconds, typical completion below 20 seconds, and the hard deadline MUST remain 45 seconds. Qdrant persistence and alias rollback MUST pass, and controlled alert tests MUST fire for error rate, `429`, p95 latency, daily token/cost, and ingestion failure.

#### Scenario: Load and failure evaluation completes
- **WHEN** the candidate is tested under the documented load profile and injected dependency failures
- **THEN** rollout is blocked unless all latency, deadline, status, stream, persistence, rollback, and alert gates pass

### Requirement: Cost and cache evaluation scorecard
Evaluation MUST prove that 100% of tested requests enforce the initial 800-output-token cap, 12,000-character context cap, and 5-source cap, and that no provider retry occurs after the first response byte. It MUST verify unchanged-hash embedding skips within one manifest version, changed-document embedding counts, and creation and evaluation of a new collection after embedding model, dimension, or chunker changes. Cache tests MUST prove request isolation, absence of prohibited content, and key/configuration refresh within 30 seconds. Token and cost reports MUST be reconcilable against sampled provider usage and grouped by day, model, status, and grounded-success classification.

#### Scenario: Budget and cache evidence is incomplete
- **WHEN** any tested request exceeds a fixed budget, retries after first byte, leaks cached request data, or retains a rotated key beyond 30 seconds
- **THEN** the candidate fails the cost and cache release gate

### Requirement: Cost threshold controls rollout
A measured baseline and approved threshold for cost per successful grounded answer MUST be recorded before the 10% rollout. Advancement to 50% and 100% MUST occur only while measured cost remains within that threshold and all response-quality and performance gates continue to pass; the threshold SHALL be treated as an environment-specific release criterion rather than a fixed cost guarantee.

#### Scenario: Cost rises beyond the approved threshold
- **WHEN** monitored cost per successful grounded answer exceeds the approved release threshold at or after 10% rollout
- **THEN** rollout does not advance and the release is disabled or held according to rollback policy

### Requirement: Evaluation evidence is a rollout prerequisite
Each rollout stage MUST have current two-reviewer rubric results, automated URL/citation/anchor checks, claim-to-source annotations, security results, accessibility results, load results, monitoring alert records, and ingestion/evaluation status. No score SHALL imply correctness beyond the measured dataset, test environment, model/prompt/corpus versions, and monitored rollout.

#### Scenario: Candidate passes only a subset of scorecards
- **WHEN** one or more required quality, security, accessibility, reliability, cost, or deployment evidence sets are absent or stale
- **THEN** the candidate cannot advance to the next rollout stage
