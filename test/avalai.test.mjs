import assert from "node:assert/strict";
import test from "node:test";
import { encrypt } from "../src/lib/crypto.mjs";
import {
  AvalaiProviderError,
  AvalaiStreamError,
  normalizeAvalaiConfig,
  parseAvalaiSse,
  requestAvalai,
  safeProviderMetadata,
  streamAvalai,
} from "../src/lib/avalai.mjs";

const env = {
  ENCRYPTION_KEY_CURRENT_VERSION: "1",
  ENCRYPTION_KEY_V1: "33".repeat(32),
  AVALAI_ALLOWED_HOSTS: "api.avalai.ir",
  AVALAI_ALLOWED_MODELS: "deepseek-v4-flash",
};
const config = {
  avalaiBaseUrl: "https://api.avalai.ir/v1",
  defaultModel: "deepseek-v4-flash",
  avalaiKeyEnc: encrypt("test-provider-key", env),
};

function body(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function response({ url = "https://api.avalai.ir/v1/chat/completions", status = 200, headers = {}, chunks = [] } = {}) {
  return { url, status, ok: status >= 200 && status < 300, headers: new Headers(headers), body: body(chunks) };
}

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) values.push(value);
  return values;
}

test("AvalAI adapter constructs only the bounded allowlisted server request", async () => {
  let request;
  const result = await requestAvalai({
    config,
    env,
    messages: [{ role: "system", content: "bounded system" }, { role: "user", content: "سلام" }],
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ headers: { "avalai-request-id": "req-safe_123", "retry-after": "7", authorization: "must-not-escape" } });
    },
  });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.avalai.ir/v1/chat/completions");
  assert.equal(request.options.redirect, "error");
  assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model", "stream", "stream_options"]);
  assert.equal(body.max_tokens, 800);
  assert.equal(result.metadata.requestId, "req-safe_123");
  assert.equal(result.metadata.retryAfter, 7);
  assert.equal("authorization" in result.metadata, false);
  assert.equal("headers" in result.metadata, false);
  result.dispose();
});

test("AvalAI policy rejects SSRF, models, redirects, and oversized construction", async () => {
  for (const baseUrl of [
    "http://api.avalai.ir/v1",
    "https://evil.example/v1",
    "https://api.avalai.ir.evil.example/v1",
    "https://api.avalai.ir/v1/other",
    "https://user:pass@api.avalai.ir/v1",
  ]) assert.throws(() => normalizeAvalaiConfig({ baseUrl, model: "deepseek-v4-flash" }, env));
  assert.throws(() => normalizeAvalaiConfig({ baseUrl: config.avalaiBaseUrl, model: "unknown" }, env));
  await assert.rejects(() => requestAvalai({
    config,
    env,
    messages: [{ role: "user", content: "x" }],
    fetchImpl: async () => response({ url: "https://evil.example/v1/chat/completions" }),
  }));
  await assert.rejects(() => requestAvalai({ config, env, maxTokens: 801, messages: [{ role: "user", content: "x" }] }));
  await assert.rejects(() => requestAvalai({ config, env, messages: [{ role: "user", content: "x".repeat(28_001) }] }));
});

test("restricted SSE parser handles arbitrary chunk boundaries and normalized usage", async () => {
  const wire = [
    'data: {"choices":[{"delta":{"content":"سلام"},"finish_reason":null}],"model":"deepseek-v4-flash"}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  const events = await collect(parseAvalaiSse(body([...wire].map((character) => character))));
  assert.deepEqual(events, [
    { type: "delta", text: "سلام" },
    { type: "usage", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, model: undefined, finishReason: "stop" },
    { type: "done" },
  ]);
});

test("restricted SSE parser rejects malformed, partial, frame, output, and token overflow", async () => {
  const cases = [
    [body(["data: {bad}\n\n"]), "malformed_provider_json"],
    [body(["data: {}"]), "truncated_sse_frame"],
    [body([`data: ${"x".repeat(70_000)}`]), "buffer_limit"],
    [body([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "x".repeat(40_000) }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "y".repeat(40_000) }, finish_reason: null }] })}\n\n`,
    ]), "output_limit"],
    [body(['data: {"choices":[],"usage":{"completion_tokens":801}}\n\n']), "output_token_limit"],
  ];
  for (const [stream, code] of cases) {
    await assert.rejects(() => collect(parseAvalaiSse(stream)), (error) => error instanceof AvalaiStreamError && error.code === code);
  }
  const emitted = [];
  await assert.rejects(async () => {
    for await (const event of parseAvalaiSse(body([
      "data: [DONE]\n\n",
      'data: {"choices":[]}\n\n',
    ]))) emitted.push(event);
  }, (error) => error.code === "event_after_done");
  assert.equal(emitted.some(({ type }) => type === "done"), false);
});

test("provider retries only 429/5xx before bytes, at most twice", async () => {
  let calls = 0;
  const responses = [
    response({ status: 429, headers: { "retry-after": "1" } }),
    response({ status: 503 }),
    response({ chunks: ['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: [DONE]\n\n'] }),
  ];
  const events = await collect(streamAvalai({
    config,
    env,
    messages: [{ role: "user", content: "x" }],
    fetchImpl: async () => responses[calls++],
    clock: () => 0,
    totalDeadlineMs: 10_000,
    sleep: async () => {},
    random: () => 0,
  }));
  assert.equal(calls, 3);
  assert.equal(events.filter(({ type }) => type === "delta")[0].text, "ok");

  calls = 0;
  await assert.rejects(
    () => collect(streamAvalai({
      config,
      env,
      messages: [{ role: "user", content: "x" }],
      fetchImpl: async () => { calls += 1; return response({ status: 400 }); },
      clock: () => 0,
      totalDeadlineMs: 10_000,
    })),
    AvalaiProviderError,
  );
  assert.equal(calls, 1);
});

test("parser failure cancels provider reader and abort stops all retries", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("data: {bad}\n\n")); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(() => collect(parseAvalaiSse(stream)), AvalaiStreamError);
  assert.equal(cancelled, true);

  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(() => collect(streamAvalai({
    config,
    env,
    messages: [{ role: "user", content: "x" }],
    signal: controller.signal,
    fetchImpl: async () => { calls += 1; return response({ status: 503 }); },
  })), (error) => error.name === "AbortError");
  assert.equal(calls, 0);
});

test("provider never retries malformed output after first byte", async () => {
  let calls = 0;
  await assert.rejects(() => collect(streamAvalai({
    config,
    env,
    messages: [{ role: "user", content: "x" }],
    fetchImpl: async () => {
      calls += 1;
      return response({ chunks: ["data: {bad}\n\n"] });
    },
    clock: () => 0,
    totalDeadlineMs: 10_000,
  })), AvalaiStreamError);
  assert.equal(calls, 1);
});

test("AvalAI adapter propagates abort/deadline and sanitizes provider metadata", async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  await assert.rejects(
    () => requestAvalai({ config, env, messages: [{ role: "user", content: "x" }], deadlineMs: 2, clock: () => 0, fetchImpl }),
    (error) => error.name === "TimeoutError",
  );
  const controller = new AbortController();
  const pending = requestAvalai({ config, env, messages: [{ role: "user", content: "x" }], signal: controller.signal, deadlineMs: 1_000, clock: () => 0, fetchImpl });
  controller.abort();
  await assert.rejects(() => pending, (error) => error.name === "AbortError");

  const metadata = safeProviderMetadata(response({ headers: { "avalai-request-id": "bad header value!", "retry-after": "99999" } }));
  assert.equal(metadata.requestId, undefined);
  assert.equal(metadata.retryAfter, undefined);
});
