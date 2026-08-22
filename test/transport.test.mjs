import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assistantSessionId,
  boundedHistory,
  realTransport,
} from "../src/lib/assistant/transport.mjs";

const request = {
  sessionId: "123e4567-e89b-12d3-a456-426614174000",
  mode: "normal",
  message: "domain",
  history: [],
  page: { path: "/paas/", title: "PaaS" },
};

function responseFrom(text, { chunks = [text.length], status = 200, contentType = "text/event-stream" } = {}) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      const size = chunks.shift() ?? bytes.length - offset;
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  }), { status, headers: { "content-type": contentType } });
}

test("real transport parses canonical SSE across arbitrary chunk boundaries", async () => {
  const wire = [
    'event: meta\ndata: {"requestId":"r1","model":"m1"}\n\n',
    'event: sources\ndata: [{"id":"S1","title":"Docs","url":"/docs/","anchor":"intro","snippet":"text"}]\n\n',
    ': ping\n\n',
    'event: delta\ndata: {"text":"answer [S1]"}\n\n',
    'event: done\ndata: {"finishReason":"stop","usage":null}\n\n',
  ].join("");
  let captured;
  const events = [];
  for await (const event of realTransport(request, {
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return responseFrom(wire, { chunks: Array.from({ length: wire.length }, () => 1) });
    },
  })) events.push(event);
  assert.equal(captured.url, "/api/docs-query");
  assert.equal(captured.options.method, "POST");
  assert.deepEqual(JSON.parse(captured.options.body), request);
  assert.deepEqual(events.map(({ type }) => type), ["meta", "sources", "delta", "done"]);
  assert.equal(events[2].text, "answer [S1]");
});

test("real transport normalizes bounded HTTP failures without mock fallback", async () => {
  let calls = 0;
  const events = [];
  for await (const event of realTransport(request, {
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ code: "RATE_LIMITED", requestId: "r2", internal: "hidden" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    },
  })) events.push(event);
  assert.equal(calls, 1);
  assert.deepEqual(events, [
    { type: "meta", requestId: "r2", model: "unavailable" },
    { type: "error", code: "RATE_LIMITED", requestId: "r2", retryable: true },
  ]);

  calls = 0;
  await assert.rejects(async () => {
    for await (const _event of realTransport(request, {
      fetchImpl: async () => { calls += 1; throw new TypeError("network down"); },
    })) { /* no events */ }
  }, TypeError);
  assert.equal(calls, 1);
});

test("real transport rejects malformed order, truncated EOF, and wrong content type", async () => {
  for (const response of [
    responseFrom('event: delta\ndata: {"text":"early"}\n\n'),
    responseFrom('event: meta\ndata: {"requestId":"r","model":"m"}\n\n'),
    responseFrom(`event: meta\ndata: {"requestId":"r","model":"${"m".repeat(70_000)}"}\n\n`),
    responseFrom("not SSE", { contentType: "text/plain" }),
  ]) {
    await assert.rejects(async () => {
      for await (const _event of realTransport(request, { fetchImpl: async () => response })) { /* no events */ }
    });
  }
});

test("real transport bounds pre-stream error bodies while reading", async () => {
  await assert.rejects(async () => {
    for await (const _event of realTransport(request, {
      fetchImpl: async () => new Response("x".repeat(70_000), { status: 502 }),
    })) { /* no events */ }
  }, /too large/);
});

test("session and history helpers keep only valid bounded browser context", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(assistantSessionId(storage, () => uuid), uuid);
  assert.equal(assistantSessionId(storage, () => { throw new Error("must reuse"); }), uuid);

  const history = boundedHistory([
    { role: "system", content: "ignore" },
    ...Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `${index}:` + "x".repeat(2_100),
    })),
  ]);
  assert.ok(history.length <= 10);
  assert.ok(history.every(({ content }) => content.length <= 2_000));
  assert.ok(history.reduce((total, { content }) => total + content.length, 0) <= 12_000);
  assert.equal(history.at(-1).content.startsWith("11:"), true);
});

test("production component selects real transport explicitly and never falls back after failure", () => {
  const component = readFileSync(new URL("../src/components/Assistant/index.jsx", import.meta.url), "utf8");
  assert.match(component, /useMockTransport \? mockTransport : realTransport/);
  assert.doesNotMatch(component, /catch[\s\S]{0,300}mockTransport/);
  assert.doesNotMatch(component, /if \(!mockEnabled\(router\.pathname\)/);
});
