import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantCompletionEvents,
  INSUFFICIENT_CONTEXT_MESSAGE,
  resolveRetrieval,
  writeAssistantEvent,
} from "../src/lib/assistant/response-events.mjs";

test("insufficient context emits exact deterministic stream and makes zero completion calls", async () => {
  let completionCalls = 0;
  const result = await resolveRetrieval({
    retrieval: { insufficientContext: true, sources: [], context: "" },
    requestId: "request-id",
    model: "deepseek-v4-flash",
    startCompletion: async () => { completionCalls += 1; },
  });
  assert.equal(completionCalls, 0);
  assert.deepEqual(result.events.map(({ type }) => type), ["meta", "sources", "delta", "done"]);
  assert.deepEqual(result.events[1].data, []);
  assert.equal(result.events[2].data.text, INSUFFICIENT_CONTEXT_MESSAGE);
  assert.equal(result.events[2].data.text, "منبع کافی پیدا نشد");
  assert.deepEqual(result.events[3].data, { finishReason: "stop", usage: null });
});

test("sufficient provider stream normalizes canonical ordering and hides source text", async () => {
  async function* providerEvents() {
    yield { type: "delta", text: "پاسخ" };
    yield { type: "usage", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, finishReason: "stop" };
    yield { type: "done" };
  }
  const events = [];
  let summary;
  for await (const event of assistantCompletionEvents({
    requestId: "request-id",
    model: "deepseek-v4-flash",
    sources: [{ id: "S1", title: "Guide", url: "/guide/", anchor: "install", snippet: "short", text: "private full context" }],
    providerEvents: providerEvents(),
    onSummary: (value) => { summary = value; },
  })) events.push(event);
  assert.deepEqual(events.map(({ type }) => type), ["meta", "sources", "delta", "done"]);
  assert.equal(JSON.stringify(events).includes("private full context"), false);
  assert.deepEqual(events.at(-1).data, { finishReason: "stop", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
  assert.deepEqual(summary, { finishReason: "stop", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, citationValid: false });
});

test("sufficient context starts completion exactly once", async () => {
  let calls = 0;
  const result = await resolveRetrieval({
    retrieval: { insufficientContext: false, sources: [{ id: "S1" }], context: "source" },
    requestId: "request-id",
    model: "deepseek-v4-flash",
    startCompletion: async () => ++calls,
  });
  assert.equal(calls, 1);
  assert.equal(result.events, null);
  assert.equal(result.completion, 1);
});

test("grounded summary requires current-request citations across delta boundaries", async () => {
  async function* providerEvents(parts) {
    for (const text of parts) yield { type: "delta", text };
    yield { type: "done" };
  }
  for (const [parts, expected] of [
    [["answer [", "S1]"], true],
    [["answer without citation"], false],
    [["answer [S1] and unknown [S9]"], false],
  ]) {
    let summary;
    for await (const _event of assistantCompletionEvents({
      requestId: "request-id",
      model: "model",
      sources: [{ id: "S1", title: "Docs", url: "/docs/", anchor: "intro", snippet: "text" }],
      providerEvents: providerEvents(parts),
      onSummary: (value) => { summary = value; },
    })) { /* consume */ }
    assert.equal(summary.citationValid, expected);
  }
});

test("response writer stops immediately after abort or socket teardown", () => {
  let writes = 0;
  const response = {
    destroyed: false,
    writableEnded: false,
    write: () => { writes += 1; return true; },
  };
  const event = { type: "delta", data: { text: "answer" } };
  const controller = new AbortController();
  assert.equal(writeAssistantEvent(response, event, { signal: controller.signal }), true);
  controller.abort(new DOMException("Stopped", "AbortError"));
  assert.throws(() => writeAssistantEvent(response, event, { signal: controller.signal }), { name: "AbortError" });
  response.destroyed = true;
  assert.throws(() => writeAssistantEvent(response, event), { name: "AbortError" });
  assert.equal(writes, 1);
});
