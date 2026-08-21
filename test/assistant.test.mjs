import test from "node:test";
import assert from "node:assert/strict";
import {
  assistantReducer,
  initialAssistantState,
  textDirection,
  validSource,
  validateEvent,
} from "../src/lib/assistant/contract.mjs";
import { mockTransport } from "../src/lib/assistant/mock.mjs";
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

test("mock success follows event contract", async () => {
  const types = [];
  for await (const event of mockTransport({ message: "domain" }, { scenario: "success" })) types.push(event.type);
  assert.deepEqual(types.slice(0, 2), ["meta", "sources"]);
  assert.ok(types.includes("delta"));
  assert.deepEqual(types.slice(-2), ["suggestions", "done"]);
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
  assert.equal(assistantReducer(state, { type: "event", event: { type: "done" } }).phase, "done");
  assert.equal(assistantReducer(state, { type: "clear" }).hydrated, true);
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

test("composer defaults RTL and follows first typed language", () => {
  assert.equal(textDirection(""), "rtl");
  assert.equal(textDirection("سلام hello"), "rtl");
  assert.equal(textDirection("hello سلام"), "ltr");
  assert.equal(textDirection("123 npm install"), "ltr");
});

test("sources allow internal paths only", () => {
  assert.equal(validSource({ id: "1", title: "ok", url: "/paas/about/" }), true);
  assert.equal(validSource({ id: "1", title: "bad", url: "//evil.example" }), false);
  assert.throws(() => validateEvent({ type: "sources", sources: [{ id: "1", title: "bad", url: "javascript:alert(1)" }] }));
});
