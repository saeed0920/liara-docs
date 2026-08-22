import assert from "node:assert/strict";
import test from "node:test";
import { AvalaiProviderError, AvalaiStreamError } from "../src/lib/avalai.mjs";
import { EngineClientError } from "../src/lib/assistant/engine-client.mjs";
import { publicFailure, terminalFailure } from "../src/lib/assistant/failures.mjs";
import { RequestFailure } from "../src/lib/assistant/request-state.mjs";

test("prestream failures map only to sanitized public statuses", () => {
  const cases = [
    [new RequestFailure(429, "rate_limited", 12), { status: 429, code: "RATE_LIMITED", retryAfter: 12 }],
    [new RequestFailure(503, "assistant_disabled"), { status: 503, code: "ASSISTANT_DISABLED" }],
    [new EngineClientError("engine_unavailable"), { status: 502, code: "RETRIEVAL_FAILED" }],
    [new EngineClientError("engine_timeout"), { status: 504, code: "TIMEOUT" }],
    [new AvalaiProviderError({ status: 503, requestId: "provider", retryAfter: 1 }), { status: 502, code: "PROVIDER_UNAVAILABLE" }],
    [new Error("AvalAI model is not allowed"), { status: 503, code: "DEPENDENCY_UNAVAILABLE" }],
    [new DOMException("secret internal timeout", "TimeoutError"), { status: 504, code: "TIMEOUT" }],
  ];
  for (const [error, expected] of cases) {
    const failure = publicFailure(error);
    assert.equal(failure.status, expected.status);
    assert.equal(failure.code, expected.code);
    if (expected.retryAfter) assert.equal(failure.retryAfter, expected.retryAfter);
    assert.equal(JSON.stringify(failure).includes("secret internal"), false);
    assert.equal(JSON.stringify(failure).includes("provider"), false);
  }
});

test("post-commit failure is one sanitized terminal error replacing done", () => {
  const event = terminalFailure(new AvalaiStreamError("raw_parser_detail"), "request-id");
  assert.deepEqual(event, {
    type: "error",
    data: { code: "UPSTREAM_STREAM_FAILED", requestId: "request-id", retryable: false },
  });
  assert.equal(JSON.stringify(event).includes("raw_parser_detail"), false);
  assert.equal(terminalFailure(new DOMException("disconnect", "AbortError"), "request-id").data.code, "CANCELLED");
});
