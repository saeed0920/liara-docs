## Purpose

Define the safe, accessible, responsive assistant experience for streaming grounded answers, source navigation, and bounded session continuity.

## ADDED Requirements

### Requirement: Assistant launch and responsive presentation
The assistant SHALL provide a launcher, panel, composer, Stop, Retry, follow-up input, and source navigation. At desktop widths it MUST use a dock-right presentation, and on mobile it MUST use a bottom sheet without horizontal page overflow or loss of composer, Stop, Retry, or citation operation at 360, 768, and 1440 pixels. The assistant MUST work in dark and light modes.

#### Scenario: Assistant opens on a mobile viewport
- **WHEN** a user opens the assistant at 360 pixels wide
- **THEN** it appears as an operable bottom sheet with no horizontal page overflow

#### Scenario: Assistant opens on a desktop viewport
- **WHEN** a user opens the assistant at 1440 pixels wide
- **THEN** it appears docked to the right while all conversation controls remain operable

### Requirement: Output modes and grounded interaction
The user SHALL be able to select only `normal`, `tutorial`, or `command`, and mode selection MUST change output form only, not model, provider, security scope, retrieval limits, prompt authority, or token budget. `normal` MUST request a short direct response. `tutorial` MUST request numbered steps with prerequisites and a verifiable result. `command` MUST present documented commands in code blocks, explain their effects, warn about destructive operations, and MUST NOT present an unsourced command. The assistant MUST NOT execute commands, mutate infrastructure, invoke side-effecting tools, or claim an operation completed. It MUST ask a concise follow-up only when missing information materially affects correctness, safety, or source selection; otherwise it MUST answer directly or abstain.

#### Scenario: Command-mode destructive operation
- **WHEN** returned sources support a destructive command and the user selects `command`
- **THEN** the response presents the sourced command in a code block, explains its effect, warns that it is destructive, and does not execute it

#### Scenario: Materially ambiguous question
- **WHEN** missing information materially changes the correct answer or source selection
- **THEN** the assistant asks a concise clarifying question rather than inventing an assumption

### Requirement: Streaming lifecycle and recovery
The UI MUST expose streaming, source, completion, visible error, stopped, and retry states and MUST handle canonical and invalid event sequences deterministically. Stop MUST cancel an in-progress request; Retry MUST initiate a new attempt after an error or interruption; and a terminal stream error after partial content MUST remain visibly distinguishable from a completed answer. Production MUST use the real transport and MUST never fall back to mock during outage or on a public route. Mock transport MUST be restricted to local or preview contexts and MUST use the same event contract as production.

#### Scenario: Stream breaks after partial content
- **WHEN** the UI receives valid partial deltas followed by a terminal `error` event
- **THEN** it preserves deterministic partial-stream presentation, shows a visible error and Retry control, and does not mark the answer complete

#### Scenario: Production service is unavailable
- **WHEN** the real assistant fails in production
- **THEN** the UI displays the controlled production error and does not substitute mock content or an uncited answer

### Requirement: Citation and suggestion behavior
The UI MUST render source navigation for only citation IDs present in the current response's `sources` event. Selecting a valid citation MUST navigate to the trusted documentation URL and section anchor and highlight the target section. An unknown citation ID MUST render as ordinary text and MUST NOT become a link. Duplicate sources MUST not produce duplicate source entries. Follow-up suggestions MUST be optional, safe next steps supported by the returned sources and MUST NOT introduce uncited technical claims or bypass no-source behavior.

#### Scenario: User opens a valid citation
- **WHEN** response text cites `[S1]` and `S1` exists in the same response's sources
- **THEN** the UI links it to that source's allowlisted internal URL and anchor and highlights the destination section

#### Scenario: Response contains an unknown citation
- **WHEN** response text contains a citation ID absent from the current sources event
- **THEN** the UI displays that ID as ordinary non-clickable text

### Requirement: Bounded session continuity
The UI MUST retain only versioned session data in `sessionStorage`, capped at 10 messages and 100KB, and MUST recover safely from corrupt or incompatible stored data. Session history MAY preserve current-page context, selected mode, relevant entities, pronouns, and constraints for follow-up continuity, but the product MUST NOT infer identity, persist a user profile, synchronize or replay conversations, or use raw IP/session values for personalization. Exceeding the browser request's 10-message or 12,000-character history contract MUST be rejected rather than silently sent as valid history.

#### Scenario: Stored conversation exceeds its cap
- **WHEN** retaining another turn would exceed 10 stored messages or 100KB
- **THEN** the UI evicts or declines session data while remaining within both caps

#### Scenario: Stored session is corrupt
- **WHEN** the UI loads malformed or unsupported-version assistant data from `sessionStorage`
- **THEN** it discards or resets that data safely without executing content or breaking the assistant

### Requirement: Keyboard and focus accessibility
The assistant MUST support `Cmd/Ctrl+I` to invoke it, `Esc` to close it, `Enter` to submit, and `Shift+Enter` to insert a line break. Closing the assistant MUST return focus to the invoking control. Controls MUST have accessible names and visible focus, follow a logical focus order, and MUST NOT create a keyboard trap. Loading, source, error, and completion state changes MUST be exposed to assistive technology.

#### Scenario: Keyboard-only interaction
- **WHEN** a keyboard user opens the assistant with `Cmd/Ctrl+I`, composes with `Shift+Enter`, submits with `Enter`, and closes with `Esc`
- **THEN** every action works in logical focus order and focus returns to the launcher after closing

#### Scenario: Stream state changes
- **WHEN** the assistant transitions through loading, sources, completion, or error
- **THEN** the changed state is exposed to assistive technology without moving focus into a trap

### Requirement: Safe rich-content rendering
The UI MUST render streamed content through React escaping or equivalent text-safe behavior and MUST NOT execute raw HTML. It SHALL support only restricted Markdown, code blocks, and safe links. Internal links MUST resolve only to allowlisted documentation routes; external links MUST use `noopener noreferrer`. Renderer and content-security protections MUST prevent source text, model output, stored session data, or streaming boundaries from executing script.

#### Scenario: Assistant output contains raw HTML or script
- **WHEN** a stream or stored response contains raw HTML, event handlers, or script markup
- **THEN** the UI renders it inertly and executes none of it

#### Scenario: External link is rendered
- **WHEN** allowed restricted Markdown contains an external link
- **THEN** the rendered link includes `noopener noreferrer`

### Requirement: Deterministic experience validation
The experience MUST define deterministic fixtures named `success`, `slow`, `empty`, `rate-limit`, `provider-error`, `broken-stream`, `rich-content`, and `long-thread`, using only source IDs `S1` through `S5`, canonical events, and canonical finish reasons. Release MUST have no critical or serious automated accessibility violations, MUST pass keyboard and focus checks at 360, 768, and 1440 pixels, and MUST pass XSS, storage-corruption, abort, broken-stream, unknown-citation, and long-thread behavior checks.

#### Scenario: User experience is evaluated for release
- **WHEN** the assistant UI is proposed for production rollout
- **THEN** all eight named fixtures and the accessibility, viewport, keyboard, focus, security, storage, abort, citation, and long-thread gates pass
