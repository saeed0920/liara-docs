import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assistantReducer,
  createEventSequenceValidator,
  dedupeSources,
  initialAssistantState,
  safeAssistantHref,
  sourceForCitation,
  validSource,
  validateEvent,
} from "../src/lib/assistant/contract.mjs";
import { mockEnabled, mockTransport } from "../src/lib/assistant/mock.mjs";
import {
  loadPreference,
  loadThread,
  savePreference,
  saveThread,
} from "../src/lib/assistant/storage.mjs";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test("mock selection is limited to local or preview demo contexts", () => {
  assert.equal(mockEnabled("/docs", { nodeEnv: "development" }), true);
  assert.equal(mockEnabled("/assistant-demo", { nodeEnv: "production", deploymentEnv: "preview" }), true);
  assert.equal(mockEnabled("/docs", { nodeEnv: "production", deploymentEnv: "preview" }), false);
  assert.equal(mockEnabled("/assistant-demo", { nodeEnv: "production", deploymentEnv: "production" }), false);
});

test("all eight mock fixtures are bounded, deterministic, and make no network request", async () => {
  const originalFetch = globalThis.fetch;
  const fixtures = {};
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("network forbidden in mock fixture"); };
  try {
    for (const scenario of ["success", "slow", "empty", "rate-limit", "provider-error", "broken-stream", "rich-content", "long-thread"]) {
      fixtures[scenario] = [];
      for await (const event of mockTransport({ message: "domain" }, { scenario })) fixtures[scenario].push(event);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  const answer = (scenario) => fixtures[scenario].filter(({ type }) => type === "delta").map(({ text }) => text).join("");
  assert.equal(calls, 0);
  assert.ok(["success", "slow", "empty", "rich-content", "long-thread"].every((scenario) => fixtures[scenario].at(-1).type === "done"));
  assert.ok(["rate-limit", "provider-error", "broken-stream"].every((scenario) => fixtures[scenario].at(-1).type === "error"));
  assert.equal(answer("empty"), "منبع کافی پیدا نشد");
  assert.equal(fixtures.empty.some(({ type }) => type === "suggestions"), false);
  assert.match(answer("rich-content"), /<div onclick=/);
  assert.ok(answer("long-thread").length > 1_000);
  assert.ok(answer("broken-stream").length > 0);
  assert.ok(Object.values(fixtures).flat(2).flatMap((event) => event.sources ?? []).every(({ id }) => /^S[1-5]$/.test(id)));
  assert.ok(Object.values(fixtures).flat().filter(({ type }) => type === "sources").every(({ sources }) => new Set(sources.map(({ id }) => id)).size === sources.length));
});

test("mock success follows event contract", async () => {
  const types = [];
  for await (const event of mockTransport({ message: "domain" }, { scenario: "success" })) types.push(event.type);
  assert.deepEqual(types.slice(0, 2), ["meta", "sources"]);
  assert.ok(types.includes("delta"));
  assert.deepEqual(types.slice(-2), ["suggestions", "done"]);
});

test("guided mock lets UI build question from options", async () => {
  let choices;
  for await (const event of mockTransport({ message: "برای شروع راهنمایی‌ام کن" }, { scenario: "success" })) {
    if (event.type === "suggestions") choices = event;
  }
  assert.deepEqual(choices.suggestions, [
    "می‌خواهم برنامه‌ام را مستقر کنم.",
    "می‌خواهم دامنه متصل کنم.",
    "می‌خواهم به PostgreSQL وصل شوم.",
  ]);
});

test("slow stream honors AbortSignal", async () => {
  const controller = new AbortController();
  await assert.rejects(async () => {
    for await (const event of mockTransport({}, { scenario: "slow", signal: controller.signal })) {
      if (event.type === "delta") controller.abort();
    }
  }, { name: "AbortError" });
});

test("reducer reaches streaming, stopped, and done states", () => {
  const user = { id: "u", role: "user", content: "q", status: "done" };
  const assistant = { id: "a", role: "assistant" };
  let state = assistantReducer(initialAssistantState, { type: "submit", user, assistant });
  assert.equal(state.phase, "submitting");
  state = assistantReducer(state, { type: "event", event: { type: "delta", text: "answer" } });
  assert.equal(state.phase, "streaming");
  assert.equal(state.messages.at(-1).content, "answer");
  assert.equal(assistantReducer(state, { type: "stop" }).phase, "stopped");
  assert.equal(assistantReducer(state, { type: "event", event: { type: "done", finishReason: "stop", usage: null } }).phase, "done");
  assert.equal(assistantReducer(state, { type: "clear" }).hydrated, true);
});

test("reducer preserves partial errors and exposes Retry, suggestions, sources, and completion", () => {
  const user = { id: "u", role: "user", content: "q", status: "done" };
  const assistant = { id: "a", role: "assistant" };
  let state = assistantReducer(initialAssistantState, { type: "submit", user, assistant });
  state = assistantReducer(state, { type: "event", event: { type: "sources", sources: [{ id: "S1", title: "docs", url: "/docs", anchor: "intro", snippet: "text" }] } });
  state = assistantReducer(state, { type: "event", event: { type: "delta", text: "partial" } });
  state = assistantReducer(state, { type: "event", event: { type: "error", code: "UPSTREAM_STREAM_FAILED", requestId: "r", retryable: true } });
  assert.equal(state.phase, "error");
  assert.equal(state.messages.at(-1).content, "partial");
  assert.equal(state.messages.at(-1).sources[0].id, "S1");
  assert.match(state.error.message, /ارتباط/);
  state = assistantReducer(state, { type: "retry", assistant: { ...assistant, id: "retry" } });
  assert.equal(state.phase, "submitting");
  assert.equal(state.messages.at(-1).content, "");
  state = assistantReducer(state, { type: "event", event: { type: "suggestions", suggestions: ["next"] } });
  state = assistantReducer(state, { type: "event", event: { type: "done", finishReason: "stop", usage: null } });
  assert.equal(state.phase, "done");
  assert.deepEqual(state.suggestions, ["next"]);
});

test("storage keeps ten valid messages and survives corruption", () => {
  const storage = memoryStorage();
  const messages = Array.from({ length: 12 }, (_, index) => ({ id: `${index}`, role: index % 2 ? "assistant" : "user", content: `${index}` }));
  saveThread(messages, storage);
  const loaded = loadThread(storage);
  assert.equal(loaded.length, 10);
  assert.equal(loaded[0].content, "2");
  storage.setItem("liara-docs-assistant:v1", "not json");
  assert.deepEqual(loadThread(storage), []);
  assert.equal(storage.getItem("liara-docs-assistant:v1"), null);
});

test("storage enforces 100KB UTF-8 cap on save and recovery", () => {
  const storage = memoryStorage();
  assert.deepEqual(saveThread([{ id: "large", role: "user", content: "ش".repeat(60_000) }], storage), []);
  assert.ok(new TextEncoder().encode(storage.getItem("liara-docs-assistant:v1")).byteLength <= 100_000);
  storage.setItem("liara-docs-assistant:v1", JSON.stringify({ version: 1, messages: Array.from({ length: 11 }, (_, id) => ({ id, role: "user", content: "x" })) }));
  assert.deepEqual(loadThread(storage), []);
  assert.equal(storage.getItem("liara-docs-assistant:v1"), null);
});

test("response preference persists and command mode stays compact", async () => {
  const storage = memoryStorage();
  assert.equal(loadPreference(storage), "normal");
  savePreference("command", storage);
  assert.equal(loadPreference(storage), "command");

  let answer = "";
  const types = [];
  for await (const event of mockTransport({ message: "برنامه را مستقر کن" }, { scenario: "success", mode: "command" })) {
    types.push(event.type);
    if (event.type === "delta") answer += event.text;
  }
  assert.match(answer, /liara deploy --app my-app/);
  assert.equal(types.includes("suggestions"), false);

  answer = "";
  for await (const event of mockTransport({ message: "دامنه را متصل کن" }, { scenario: "success", mode: "command" })) {
    if (event.type === "delta") answer += event.text;
  }
  assert.match(answer, /دستور مستقیمی.*وجود ندارد/);
  assert.match(answer, /رکورد.*DNS/);
});

test("stream contract accepts canonical success and partial output followed by terminal error", () => {
  const success = createEventSequenceValidator();
  success.push({ type: "meta", requestId: "r1", model: "m" });
  success.push({ type: "sources", sources: [] });
  success.push({ type: "delta", text: "partial" });
  success.push({ type: "suggestions", suggestions: ["next"] });
  success.push({ type: "done", finishReason: "stop", usage: null });
  success.end();

  const failed = createEventSequenceValidator();
  failed.push({ type: "meta", requestId: "r2", model: "m" });
  failed.push({ type: "sources", sources: [] });
  failed.push({ type: "delta", text: "partial" });
  failed.push({ type: "error", code: "UPSTREAM_STREAM_FAILED", requestId: "r2", retryable: true });
  failed.end();
});

test("stream contract rejects malformed order, duplicate terminal events, and EOF without terminal", () => {
  assert.throws(() => createEventSequenceValidator().push({ type: "delta", text: "early" }));

  const duplicate = createEventSequenceValidator();
  duplicate.push({ type: "meta", requestId: "r", model: "m" });
  duplicate.push({ type: "error", code: "FAILED", requestId: "r", retryable: false });
  assert.throws(() => duplicate.push({ type: "done", finishReason: "error", usage: null }));

  const eof = createEventSequenceValidator();
  eof.push({ type: "meta", requestId: "r", model: "m" });
  eof.push({ type: "sources", sources: [] });
  assert.throws(() => eof.end());
});

test("restricted Markdown links allow internal paths and HTTPS only", () => {
  assert.equal(safeAssistantHref("/paas/docs/#intro"), "/paas/docs/#intro");
  assert.equal(safeAssistantHref("https://example.com/docs"), "https://example.com/docs");
  for (const unsafe of ["//evil.example/x", "javascript:alert(1)", "http://example.com", "/docs/../admin", "/docs/%2e%2e/admin", "data:text/html,x", "/docs\\admin"]) {
    assert.equal(safeAssistantHref(unsafe), "");
  }
});

test("renderer keeps HTML inert, protects external links, and wires section highlighting", () => {
  const component = readFileSync(new URL("../src/components/Assistant/index.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /dangerouslySetInnerHTML|\.innerHTML/);
  assert.match(component, /rel="noopener noreferrer"/);
  assert.match(component, /sourceForCitation\(citation, sources\)/);
  assert.match(component, /assistant-source-highlight/);
  assert.match(component, /abortRef\.current\?\.abort\(\)/);
});

test("sources allow internal paths, deduplicate targets, and leave unknown citations unresolved", () => {
  const source = { id: "S1", title: "ok", url: "/paas/about/", anchor: "intro", snippet: "text" };
  assert.equal(validSource(source), true);
  assert.equal(validSource({ ...source, id: "S2", url: "//evil.example" }), false);
  assert.equal(validSource({ ...source, id: "S2", url: "/docs/../admin" }), false);
  assert.equal(validSource({ ...source, id: "S2", anchor: "bad#anchor" }), false);
  assert.throws(() => validateEvent({ type: "sources", sources: [{ ...source, url: "javascript:alert(1)" }] }));
  assert.deepEqual(dedupeSources([source, { ...source, id: "S2" }]), [source]);
  assert.equal(sourceForCitation("S1", [source]), source);
  assert.equal(sourceForCitation("S5", [source]), null);
  assert.equal(sourceForCitation("S9", [source]), null);
});
