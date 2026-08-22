import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import test from "node:test";
import { validateAssistantConfigUpdate, validateProviderCandidate } from "../src/lib/assistant/admin-config.mjs";
import { createAssistantConfigCache } from "../src/lib/assistant/config-cache.mjs";
import { ConnectionTestLimitExceeded, createConnectionTestLimiter } from "../src/lib/assistant/connection-test-limit.mjs";
import { loadAssistantHmacKey, loadEngineTokens } from "../src/lib/assistant/runtime-secrets.mjs";
import { trustedClientIp } from "../src/lib/assistant/request-context.mjs";
import { hmacSubject } from "../src/lib/assistant/rate-limit.mjs";
import {
  currentEncryptionVersion,
  decrypt,
  encrypt,
  envelopeVersion,
  migrateAvalaiKeyEnvelope,
} from "../src/lib/crypto.mjs";
import {
  ConcurrencyLimitExceeded,
  ConcurrencySemaphore,
  withConcurrencySlot,
} from "../src/lib/assistant/concurrency.mjs";

test("versioned encryption decrypts legacy and migrates old envelopes", async () => {
  const key1 = "11".repeat(32);
  const key2 = "22".repeat(32);
  const v1 = { ENCRYPTION_KEY_CURRENT_VERSION: "1", ENCRYPTION_KEY_V1: key1 };
  const v2 = { ...v1, ENCRYPTION_KEY_CURRENT_VERSION: "2", ENCRYPTION_KEY_V2: key2 };
  const oldEnvelope = encrypt("provider-secret", v1);
  assert.equal(envelopeVersion(oldEnvelope), 1);
  assert.equal(decrypt(oldEnvelope, v2), "provider-secret");

  const iv = Buffer.alloc(12, 7);
  const legacyCipher = createCipheriv("aes-256-gcm", Buffer.from(key1, "hex"), iv);
  const legacyEncrypted = Buffer.concat([legacyCipher.update("legacy-secret", "utf8"), legacyCipher.final()]);
  const legacy = `${iv.toString("base64")}:${legacyCipher.getAuthTag().toString("base64")}:${legacyEncrypted.toString("base64")}`;
  assert.equal(decrypt(legacy, v2), "legacy-secret");

  let update;
  const migrated = await migrateAvalaiKeyEnvelope({
    env: v2,
    db: {
      config: {
        findUnique: async () => ({ avalaiKeyEnc: oldEnvelope }),
        update: async (value) => { update = value; },
      },
    },
  });
  assert.equal(migrated, true);
  assert.equal(currentEncryptionVersion(v2), 2);
  assert.equal(envelopeVersion(update.data.avalaiKeyEnc), 2);
  assert.equal(decrypt(update.data.avalaiKeyEnc, v2), "provider-secret");
  assert.equal(update.data.avalaiKeyVersion, 2);
});

test("HMAC and engine-token rotations are independent and versioned", () => {
  const session = "s".repeat(32);
  const first = loadAssistantHmacKey({
    SESSION_SECRET: session,
    ASSISTANT_HMAC_KEY_CURRENT_VERSION: "1",
    ASSISTANT_HMAC_KEY_V1: "h1".repeat(16),
  });
  const second = loadAssistantHmacKey({
    SESSION_SECRET: session,
    ASSISTANT_HMAC_KEY_CURRENT_VERSION: "2",
    ASSISTANT_HMAC_KEY_V2: "h2".repeat(16),
  });
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.notEqual(hmacSubject(first.key, "ip", "203.0.113.1"), hmacSubject(second.key, "ip", "203.0.113.1"));
  assert.throws(() => loadAssistantHmacKey({ SESSION_SECRET: session, ASSISTANT_HMAC_KEY: session }));

  const tokens = loadEngineTokens({ ENGINE_API_TOKEN: "c".repeat(32), ENGINE_API_TOKEN_NEXT: "n".repeat(32) });
  assert.equal(tokens.current.length, 32);
  assert.equal(tokens.next.length, 32);
  assert.throws(() => loadEngineTokens({ ENGINE_API_TOKEN: "same".repeat(8), ENGINE_API_TOKEN_NEXT: "same".repeat(8) }));
});

test("connection testing has an isolated bounded quota and strict candidate", () => {
  let now = 0;
  const limiter = createConnectionTestLimiter({ limit: 1, windowMs: 300_000, clock: () => now });
  limiter.consume("admin-hmac");
  assert.throws(() => limiter.consume("admin-hmac"), (error) => error instanceof ConnectionTestLimitExceeded && error.retryAfter === 300);
  now = 300_000;
  assert.equal(limiter.consume("admin-hmac").remaining, 0);
  const env = { AVALAI_ALLOWED_HOSTS: "api.avalai.ir", AVALAI_ALLOWED_MODELS: "deepseek-v4-flash" };
  assert.equal(validateProviderCandidate({ avalaiBaseUrl: "https://api.avalai.ir/v1", defaultModel: "deepseek-v4-flash" }, env).model, "deepseek-v4-flash");
  assert.throws(() => validateProviderCandidate({ avalaiBaseUrl: "https://evil.example/v1", defaultModel: "deepseek-v4-flash" }, env));
  assert.throws(() => validateProviderCandidate({ avalaiBaseUrl: "https://api.avalai.ir/v1", defaultModel: "deepseek-v4-flash", assistantEnabled: true }, env));
});

test("admin configuration accepts only allowlisted positive settings", () => {
  const env = { AVALAI_ALLOWED_HOSTS: "api.avalai.ir", AVALAI_ALLOWED_MODELS: "deepseek-v4-flash" };
  const valid = {
    avalaiBaseUrl: "https://api.avalai.ir/v1",
    defaultModel: "deepseek-v4-flash",
    assistantEnabled: false,
    assistantMinuteLimit: 10,
    assistantDayLimit: 100,
  };
  assert.equal(validateAssistantConfigUpdate(valid, env).assistantEnabled, false);
  for (const value of [
    { ...valid, assistantMinuteLimit: 0 },
    { ...valid, assistantDayLimit: 0 },
    { ...valid, defaultModel: "unknown" },
    { ...valid, avalaiBaseUrl: "http://api.avalai.ir/v1" },
    { ...valid, provider: "browser-controlled" },
  ]) assert.throws(() => validateAssistantConfigUpdate(value, env));
});

test("only the explicitly trusted client-IP header is accepted", () => {
  const headers = new Headers({ "x-liara-client-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.9" });
  assert.equal(trustedClientIp(headers, { TRUSTED_CLIENT_IP_HEADER: "x-liara-client-ip" }), "203.0.113.7");
  assert.throws(() => trustedClientIp(headers, {}));
  assert.throws(() => trustedClientIp(new Headers({ "x-liara-client-ip": "203.0.113.7, 198.51.100.9" }), { TRUSTED_CLIENT_IP_HEADER: "x-liara-client-ip" }));
  assert.throws(() => trustedClientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }), { TRUSTED_CLIENT_IP_HEADER: "x-liara-client-ip" }));
});

test("two replica-local caches observe rotation within 30 seconds", async () => {
  let now = 0;
  let model = "old";
  const options = { ttlMs: 30_000, clock: () => now, load: async () => ({ defaultModel: model }) };
  const first = createAssistantConfigCache(options);
  const second = createAssistantConfigCache(options);
  assert.equal((await first.get()).defaultModel, "old");
  assert.equal((await second.get()).defaultModel, "old");
  model = "new";
  first.invalidate();
  assert.equal((await first.get()).defaultModel, "new");
  assert.equal((await second.get()).defaultModel, "old");
  now = 30_000;
  assert.equal((await second.get()).defaultModel, "new");
});

test("config cache is bounded, isolated, and immediately invalidated", async () => {
  let now = 0;
  let loads = 0;
  const cache = createAssistantConfigCache({
    ttlMs: 30_000,
    clock: () => now,
    load: async () => {
      loads += 1;
      return {
      id: 1,
      assistantEnabled: false,
      assistantMinuteLimit: 10,
      assistantDayLimit: 100,
      prompt: "must not cache",
      authorization: "must not cache",
      requestId: "must not cache",
      };
    },
  });
  const first = await cache.get();
  assert.equal(first.assistantEnabled, false);
  assert.equal("prompt" in first, false);
  assert.equal("authorization" in first, false);
  assert.equal("requestId" in first, false);
  assert.equal(Object.isFrozen(first), true);
  now = 29_999;
  assert.equal(await cache.get(), first);
  cache.invalidate();
  const invalidated = await cache.get();
  assert.notEqual(invalidated, first);
  now = 60_000;
  await cache.get();
  assert.equal(loads, 3);
  assert.throws(() => createAssistantConfigCache({ load: async () => ({}), ttlMs: 30_001 }));
});

test("per-replica semaphore is bounded and release is idempotent", async () => {
  const semaphore = new ConcurrencySemaphore(1);
  const release = semaphore.acquire();
  assert.equal(semaphore.active, 1);
  await assert.rejects(() => withConcurrencySlot(semaphore, async () => {}), ConcurrencyLimitExceeded);
  release();
  release();
  assert.equal(semaphore.active, 0);
});

test("semaphore releases on every terminal request path", async (t) => {
  const outcomes = {
    success: async () => "ok",
    error: async () => { throw new Error("provider error"); },
    timeout: async () => { throw new DOMException("timed out", "TimeoutError"); },
    "malformed stream": async () => { throw new SyntaxError("malformed stream"); },
    Stop: async () => { throw new DOMException("stopped", "AbortError"); },
    disconnect: async () => { throw new DOMException("disconnected", "AbortError"); },
  };
  for (const [name, work] of Object.entries(outcomes)) {
    await t.test(name, async () => {
      const semaphore = new ConcurrencySemaphore(1);
      if (name === "success") assert.equal(await withConcurrencySlot(semaphore, work), "ok");
      else await assert.rejects(() => withConcurrencySlot(semaphore, work));
      assert.equal(semaphore.active, 0);
      const release = semaphore.acquire();
      assert.equal(release instanceof Function, true);
      release();
    });
  }
});
