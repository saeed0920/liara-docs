import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { ConcurrencySemaphore } from "../src/lib/assistant/concurrency.mjs";
import {
  admitDocsQuery,
  createRequestState,
  linkRequestAbort,
  RequestFailure,
} from "../src/lib/assistant/request-state.mjs";
import { RateLimitUnavailable } from "../src/lib/assistant/rate-limit.mjs";
import { beginServerShutdown, serverShutdownSignal } from "../src/lib/assistant/server-shutdown.mjs";

const request = { sessionId: "123e4567-e89b-12d3-a456-426614174000" };

test("request state enforces ordered stages and absolute 45-second monotonic deadline", () => {
  let now = 100;
  const state = createRequestState({ timeoutMs: 90_000, clock: () => now });
  assert.equal(state.deadlineMs, 45_100);
  state.enter("validated");
  assert.throws(() => state.enter("admitted"), RequestFailure);
  state.finish();

  const expired = createRequestState({ timeoutMs: 45_000, clock: () => now });
  now = expired.deadlineMs;
  assert.throws(() => expired.enter("validated"), (error) => error.name === "TimeoutError");
  expired.finish();
});

test("request disconnect aborts linked upstream work", () => {
  const state = createRequestState();
  const request = Object.assign(new EventEmitter(), { aborted: false });
  const response = Object.assign(new EventEmitter(), { writableEnded: false });
  const unlink = linkRequestAbort(state, request, response);
  response.emit("close");
  assert.equal(state.signal.aborted, true);
  assert.equal(state.signal.reason.name, "AbortError");
  unlink();
  state.finish();
});

test("incoming request abort stops work before response close", () => {
  const state = createRequestState();
  const request = Object.assign(new EventEmitter(), { aborted: false });
  const response = Object.assign(new EventEmitter(), { writableEnded: false });
  const unlink = linkRequestAbort(state, request, response);
  request.aborted = true;
  request.emit("aborted");
  assert.equal(state.signal.aborted, true);
  assert.equal(state.signal.reason.name, "AbortError");
  unlink();
  state.finish();
});

test("request state preserves cancellation reason and releases its slot in finally cleanup", () => {
  const state = createRequestState();
  let releases = 0;
  state.hold(() => { releases += 1; });
  state.abort(new DOMException("Stopped", "AbortError"));
  assert.throws(() => state.enter("validated"), (error) => error.name === "AbortError");
  state.finish();
  state.finish();
  assert.equal(releases, 1);
});

test("admission is config then quota then concurrency and releases centrally", async () => {
  const state = createRequestState();
  state.enter("validated");
  const order = [];
  const semaphore = new ConcurrencySemaphore(1);
  const result = await admitDocsQuery({
    state,
    req: { headers: { "x-client": "203.0.113.1" } },
    request,
    dependencies: {
      getConfig: async () => { order.push("config"); return { assistantEnabled: true, assistantMinuteLimit: 10, assistantDayLimit: 100, assistantConcurrencyLimit: 1 }; },
      loadHmac: () => ({ key: "h".repeat(32), version: 1 }),
      clientIp: () => "203.0.113.1",
      consumeQuota: async () => { order.push("quota"); },
      database: {},
      semaphore,
    },
  });
  order.push("concurrency");
  assert.deepEqual(order, ["config", "quota", "concurrency"]);
  assert.equal(result.ip, "203.0.113.1");
  assert.equal(semaphore.active, 1);
  state.finish();
  assert.equal(semaphore.active, 0);
});

test("server shutdown aborts linked request state", () => {
  const state = createRequestState({ signals: [serverShutdownSignal] });
  beginServerShutdown();
  assert.equal(state.signal.aborted, true);
  assert.equal(state.signal.reason.name, "AbortError");
  state.finish();
});

test("disabled and database-outage admissions fail before concurrency", async () => {
  for (const [config, consumeQuota, code] of [
    [{ assistantEnabled: false }, async () => {}, "assistant_disabled"],
    [{ assistantEnabled: true, assistantMinuteLimit: 10, assistantDayLimit: 100 }, async () => { throw new RateLimitUnavailable(); }, "rate_limit_unavailable"],
  ]) {
    const state = createRequestState();
    state.enter("validated");
    const semaphore = new ConcurrencySemaphore(1);
    await assert.rejects(() => admitDocsQuery({
      state,
      req: { headers: {} },
      request,
      dependencies: {
        getConfig: async () => config,
        loadHmac: () => ({ key: "h".repeat(32), version: 1 }),
        clientIp: () => "203.0.113.1",
        consumeQuota,
        database: {},
        semaphore,
      },
    }), (error) => error.code === code);
    assert.equal(semaphore.active, 0);
    state.finish();
  }
});
