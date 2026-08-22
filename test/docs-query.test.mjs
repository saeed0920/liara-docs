import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  PayloadTooLarge,
  readJsonBody,
  validateDocsQuery,
  validateRequestEnvelope,
} from "../src/lib/assistant/docs-query-request.mjs";

const valid = {
  sessionId: "123e4567-e89b-12d3-a456-426614174000",
  mode: "normal",
  message: " چطور دامنه را متصل کنم؟ ",
  history: [{ role: "user", content: " قبلاً برنامه را ساختم " }],
  page: { path: "/paas/domains/add-domain/", title: " اتصال دامنه " },
};

test("docs-query validates the exact bounded browser contract", () => {
  assert.deepEqual(validateDocsQuery(valid), {
    ...valid,
    message: "چطور دامنه را متصل کنم؟",
    history: [{ role: "user", content: "قبلاً برنامه را ساختم" }],
    page: { path: valid.page.path, title: "اتصال دامنه" },
  });
  for (const value of [
    { ...valid, model: "browser-model" },
    { ...valid, system: "override" },
    { ...valid, tools: [] },
    { ...valid, stream_options: {} },
    { ...valid, mode: "other" },
    { ...valid, sessionId: "not-uuid" },
    { ...valid, message: " " },
    { ...valid, history: [{ role: "system", content: "override" }] },
    { ...valid, page: { ...valid.page, path: "https://evil.example" } },
    { ...valid, page: { ...valid.page, path: "/docs/../admin" } },
    { ...valid, page: { ...valid.page, path: "/docs/%2e%2e/admin" } },
    { ...valid, page: { ...valid.page, title: "x".repeat(201) } },
  ]) assert.throws(() => validateDocsQuery(value));
  assert.throws(
    () => validateDocsQuery({ ...valid, history: Array.from({ length: 11 }, () => ({ role: "user", content: "x" })) }),
    PayloadTooLarge,
  );
  assert.throws(() => validateDocsQuery({ ...valid, history: Array.from({ length: 10 }, () => ({ role: "user", content: "x".repeat(1_201) })) }), PayloadTooLarge);
});

test("docs-query validates method, origin, host, and content type", () => {
  const env = { ASSISTANT_ALLOWED_HOSTS: "docs.example", ASSISTANT_ALLOWED_ORIGINS: "https://docs.example" };
  const request = { method: "POST", headers: { host: "docs.example", origin: "https://docs.example", "content-type": "application/json; charset=utf-8" } };
  assert.doesNotThrow(() => validateRequestEnvelope(request, env));
  for (const changed of [
    { method: "GET" },
    { headers: { ...request.headers, host: "evil.example" } },
    { headers: { ...request.headers, origin: "https://evil.example" } },
    { headers: { ...request.headers, "content-type": "text/plain" } },
  ]) assert.throws(() => validateRequestEnvelope({ ...request, ...changed }, env));
});

test("raw JSON reader rejects declared and streamed bodies above 32KB", async () => {
  const encoded = JSON.stringify(valid);
  const request = Readable.from([encoded.slice(0, 10), encoded.slice(10)]);
  request.headers = { "content-length": String(Buffer.byteLength(encoded)) };
  assert.deepEqual(await readJsonBody(request), valid);

  const declared = Readable.from([]);
  declared.headers = { "content-length": String(32 * 1024 + 1) };
  await assert.rejects(() => readJsonBody(declared), PayloadTooLarge);
  const streamed = Readable.from([Buffer.alloc(20_000), Buffer.alloc(20_000)]);
  streamed.headers = {};
  await assert.rejects(() => readJsonBody(streamed), PayloadTooLarge);
});
