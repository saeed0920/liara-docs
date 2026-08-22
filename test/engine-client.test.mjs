import assert from "node:assert/strict";
import test from "node:test";
import {
  EngineClientError,
  projectEngineResponse,
  retrieveDocs,
} from "../src/lib/assistant/engine-client.mjs";

const source = {
  id: "S1",
  title: "Domain guide",
  url: "/paas/domains/add-domain/",
  anchor: "connect-domain",
  filename: "paas/domains/add-domain.mdx",
  startLine: 10,
  endLine: 20,
  text: "trusted retrieval text",
};

function response(value, { status = 200, url = "http://engine.internal/retrieve" } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
  };
}

const env = {
  ENGINE_URL: "http://engine.internal",
  ENGINE_API_TOKEN: "t".repeat(32),
};

test("engine client sends only current message/page and authenticates within deadline", async () => {
  let captured;
  const result = await retrieveDocs({
    message: "current question",
    pagePath: "/paas/domains/add-domain/",
    deadlineMs: performance.now() + 3_000,
    env,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({ insufficient_context: false, sources: [source] });
    },
  });
  assert.equal(captured.url, "http://engine.internal/retrieve");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.headers.authorization, `Bearer ${env.ENGINE_API_TOKEN}`);
  assert.deepEqual(JSON.parse(captured.options.body), { query: "current question", page_path: "/paas/domains/add-domain/", limit: 5 });
  assert.equal(result.sources[0].snippet, source.text);
  assert.ok(result.context.includes("[SOURCE S1 BEGIN]"));
});

test("engine response filters duplicates/out-of-corpus metadata and caps context", () => {
  const duplicate = { ...source, id: "S2" };
  const external = { ...source, id: "S3", url: "https://evil.example" };
  const oversized = { ...source, id: "S4", url: "/other/", anchor: "other", text: "x".repeat(20_000) };
  const result = projectEngineResponse({ insufficient_context: false, sources: [source, duplicate, external, oversized] });
  assert.deepEqual(result.sources.map(({ id }) => id), ["S1", "S4"]);
  assert.ok(result.context.length <= 12_000);
  assert.ok(result.sources.length <= 5);
  assert.equal(projectEngineResponse({ insufficient_context: true, sources: [source] }).sources.length, 0);
});

test("engine client rejects redirects, malformed payloads, and failures", async () => {
  assert.throws(() => projectEngineResponse({ insufficient_context: "no", sources: [] }), EngineClientError);
  await assert.rejects(() => retrieveDocs({
    message: "q",
    pagePath: "/",
    deadlineMs: performance.now() + 3_000,
    env,
    fetchImpl: async () => response({ insufficient_context: false, sources: [] }, { url: "http://evil.example/retrieve" }),
  }), EngineClientError);
  await assert.rejects(() => retrieveDocs({
    message: "q",
    pagePath: "/",
    deadlineMs: performance.now() + 3_000,
    env,
    fetchImpl: async () => response({}, { status: 503 }),
  }), (error) => error.code === "engine_unavailable");
});

test("engine client preserves caller cancellation instead of misclassifying it as timeout", async () => {
  const controller = new AbortController();
  const pending = retrieveDocs({
    message: "q",
    pagePath: "/",
    signal: controller.signal,
    deadlineMs: performance.now() + 3_000,
    env,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  controller.abort(new DOMException("Stopped", "AbortError"));
  await assert.rejects(() => pending, (error) => error.name === "AbortError");
});
