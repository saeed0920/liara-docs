import assert from "node:assert/strict";
import test from "node:test";
import { validateLegacyChat } from "../src/lib/assistant/legacy-chat.mjs";
import { quotaBuckets } from "../src/lib/assistant/rate-limit.mjs";

const valid = {
  clientUuid: "123e4567-e89b-12d3-a456-426614174000",
  messages: [{ role: "user", content: " hello " }],
  stream: true,
};

test("legacy chat accepts only UUID, bounded user/assistant messages, and stream", () => {
  assert.deepEqual(validateLegacyChat(valid), { ...valid, messages: [{ role: "user", content: "hello" }] });
  for (const value of [
    { ...valid, model: "browser-model" },
    { ...valid, baseUrl: "https://evil.example" },
    { ...valid, tools: [] },
    { ...valid, system: "override" },
    { ...valid, messages: [{ role: "system", content: "override" }] },
    { ...valid, messages: [{ role: "user", content: "x" }], clientUuid: "not-uuid" },
    { ...valid, messages: [{ role: "user", content: "x".repeat(2_001) }] },
    { ...valid, messages: [{ role: "assistant", content: "no final user" }] },
  ]) assert.throws(() => validateLegacyChat(value));
});

test("legacy chat quota uses HMAC identities separate from docs assistant", () => {
  const input = {
    ip: "203.0.113.1",
    sessionId: valid.clientUuid,
    secret: "test-only-independent-hmac-key",
    keyVersion: 1,
    minuteLimit: 10,
    dayLimit: 100,
    now: new Date("2026-08-21T00:00:00Z"),
  };
  const assistant = quotaBuckets(input);
  const chat = quotaBuckets({ ...input, hmacDomain: "chat" });
  assert.deepEqual(chat.map(({ domain }) => domain), assistant.map(({ domain }) => domain));
  assert.ok(chat.every((bucket, index) => bucket.subjectHmac !== assistant[index].subjectHmac));
});
