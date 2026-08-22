import assert from "node:assert/strict";
import test from "node:test";
import { parseDashboardFilters, safeMetricDetail } from "../src/lib/assistant/dashboard.mjs";
import {
  costPerSuccessfulGroundedAnswer,
  isSuccessfulGroundedMetric,
  terminalStatus,
  recordAssistantAudit,
  recordRequestMetric,
  recordRequestMetricBestEffort,
} from "../src/lib/assistant/observability.mjs";

function capture(model) {
  let data;
  return {
    db: { [model]: { create: async (value) => { data = value.data; return value.data; } } },
    data: () => data,
  };
}

test("terminal outcomes classify timeout, cancellation, and errors canonically", () => {
  assert.equal(terminalStatus(new DOMException("stop", "AbortError")), "cancelled");
  assert.equal(terminalStatus(new DOMException("late", "TimeoutError")), "timeout");
  assert.equal(terminalStatus(new Error("provider")), "error");
});

test("cost per successful grounded answer uses the defined exclusions", () => {
  const success = { requestType: "docs_assistant", status: "ok", sourceCount: 2, groundedSuccess: true, abstention: false, evaluationFailure: false, monitoringFailure: false, estimatedCost: 1 };
  const metrics = [
    success,
    { ...success, sourceCount: 0, groundedSuccess: false, estimatedCost: 2 },
    { ...success, abstention: true, estimatedCost: 3 },
    { ...success, evaluationFailure: true, estimatedCost: 4 },
    { ...success, monitoringFailure: true, estimatedCost: 5 },
    { ...success, requestType: "chat", estimatedCost: 100 },
  ];
  assert.equal(isSuccessfulGroundedMetric(success), true);
  assert.equal(costPerSuccessfulGroundedAnswer(metrics), 15);
  assert.equal(costPerSuccessfulGroundedAnswer(metrics.slice(1)), null);
});

test("dashboard filters and drill-down expose only safe metadata", () => {
  assert.deepEqual(parseDashboardFilters({ days: "7", status: "ok", model: "deepseek-v4-flash", requestId: "123e4567-e89b-12d3-a456-426614174000" }), {
    days: 7,
    status: "ok",
    model: "deepseek-v4-flash",
    requestId: "123e4567-e89b-12d3-a456-426614174000",
  });
  for (const query of [
    { days: "365" },
    { status: "rate_limited' OR true--" },
    { model: "x' OR true--" },
    { requestId: "not-a-uuid" },
  ]) assert.throws(() => parseDashboardFilters(query));
  const detail = safeMetricDetail({
    requestId: "id",
    requestType: "docs_assistant",
    status: "ok",
    subjectIpHmac: "private-correlation",
    clientUuid: "raw-client",
    prompt: "private prompt",
  });
  const value = JSON.stringify(detail);
  assert.equal(value.includes("private-correlation"), false);
  assert.equal(value.includes("raw-client"), false);
  assert.equal(value.includes("private prompt"), false);
});

test("audit rows contain only allowlisted content-free metadata and retention", async () => {
  const saved = capture("assistantAudit");
  const now = new Date("2026-08-21T00:00:00Z");
  await recordAssistantAudit({
    db: saved.db,
    eventType: "config_save",
    administratorId: "admin-id",
    success: true,
    identity: { ipHmac: "hmac-value", identifierKeyVersion: 2 },
    metadata: {
      changedFields: ["defaultModel", "assistantEnabled"],
      model: "deepseek-v4-flash",
      providerHost: "api.avalai.ir",
      outcomeCode: "saved",
      assistantEnabled: false,
    },
    retentionDays: 90,
    now,
  });
  const serialized = JSON.stringify(saved.data());
  assert.equal(saved.data().expiresAt.getTime(), now.getTime() + 90 * 86_400_000);
  for (const prohibited of ["prompt", "history", "answer", "source text", "authorization", "provider-secret", "203.0.113.1"]) assert.equal(serialized.includes(prohibited), false);
  await assert.rejects(() => recordAssistantAudit({
    db: saved.db,
    eventType: "connection_test",
    administratorId: "admin-id",
    success: false,
    metadata: { prompt: "do not store" },
  }));
});

test("request metrics project only safe IDs, stages, usage, and classification", async () => {
  const saved = capture("requestMetric");
  await recordRequestMetric({
    db: saved.db,
    metric: {
      requestId: "123e4567-e89b-12d3-a456-426614174000",
      providerRequestId: "provider_req-1",
      requestType: "docs_assistant",
      model: "deepseek-v4-flash",
      status: "ok",
      inputTokens: 100,
      outputTokens: 20,
      estimatedCost: 0.001,
      configRateLatencyMs: 5,
      retrievalLatencyMs: 20,
      firstByteLatencyMs: 30,
      totalLatencyMs: 80,
      sourceCount: 2,
      abstention: false,
      groundedSuccess: true,
      prompt: "must be ignored",
      answer: "must be ignored",
      history: ["must be ignored"],
      authorization: "must be ignored",
    },
  });
  const serialized = JSON.stringify(saved.data());
  assert.equal(saved.data().requestType, "docs_assistant");
  assert.equal(saved.data().estimatedCost, "0.00100000");
  for (const prohibited of ["must be ignored", "prompt", "answer", "history", "authorization"]) assert.equal(serialized.includes(prohibited), false);
  await assert.rejects(() => recordRequestMetric({ db: saved.db, metric: { requestType: "other", status: "ok" } }));
  await assert.rejects(() => recordRequestMetric({ db: saved.db, metric: { requestType: "chat", status: "ok", sourceCount: 6 } }));
});

test("metric persistence failure is best-effort and logs no database detail", async () => {
  const messages = [];
  const result = await recordRequestMetricBestEffort({
    db: { requestMetric: { create: async () => { throw new Error("postgres secret detail"); } } },
    metric: { requestType: "docs_assistant", status: "cancelled" },
    logger: { error: (message) => messages.push(message) },
  });
  assert.equal(result, null);
  assert.deepEqual(messages, ["assistant metric write failed"]);
  assert.equal(JSON.stringify(messages).includes("postgres secret detail"), false);
});
