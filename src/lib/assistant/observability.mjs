import { hmacSubject } from "./rate-limit.mjs";
import { trustedClientIp } from "./request-context.mjs";
import { loadAssistantHmacKey } from "./runtime-secrets.mjs";

const AUDIT_EVENTS = new Set(["config_save", "connection_test"]);
const AUDIT_METADATA = new Set(["changedFields", "model", "providerHost", "outcomeCode", "assistantEnabled"]);
const CONFIG_FIELDS = new Set(["avalaiKey", "avalaiBaseUrl", "defaultModel", "assistantEnabled", "assistantMinuteLimit", "assistantDayLimit"]);
const STATUSES = new Set(["ok", "error", "timeout", "cancelled"]);
const REQUEST_TYPES = new Set(["chat", "docs_assistant"]);

function boundedString(value, max = 128) {
  return value == null ? null : typeof value === "string" && value.length <= max && /^[\w.:/@+-]+$/.test(value) ? value : (() => { throw new Error("unsafe observability string"); })();
}

function safeMetadata(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !AUDIT_METADATA.has(key))) throw new Error("unsafe audit metadata");
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "changedFields" && Array.isArray(item) && item.length <= 6 && item.every((entry) => CONFIG_FIELDS.has(entry))) result[key] = item;
    else if (key === "assistantEnabled" && typeof item === "boolean") result[key] = item;
    else if (["model", "providerHost", "outcomeCode"].includes(key)) result[key] = boundedString(item);
    else throw new Error("unsafe audit metadata");
  }
  return result;
}

export function auditIdentity(req, env = process.env) {
  const { key, version } = loadAssistantHmacKey(env);
  if (!env.TRUSTED_CLIENT_IP_HEADER) return { identifierKeyVersion: version };
  return {
    identifierKeyVersion: version,
    ipHmac: hmacSubject(key, "ip", trustedClientIp(req.headers, env)),
  };
}

export async function recordAssistantAudit({
  db,
  eventType,
  administratorId,
  success,
  identity = {},
  metadata = {},
  retentionDays = 90,
  now = new Date(),
}) {
  if (!AUDIT_EVENTS.has(eventType) || !administratorId || typeof success !== "boolean" || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("invalid audit event");
  return db.assistantAudit.create({
    data: {
      eventType,
      administratorId,
      success,
      ipHmac: identity.ipHmac,
      identifierKeyVersion: identity.identifierKeyVersion,
      metadata: safeMetadata(metadata),
      createdAt: now,
      expiresAt: new Date(now.getTime() + retentionDays * 86_400_000),
    },
  });
}

function optionalNonnegative(value, max = Number.MAX_SAFE_INTEGER) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error("invalid metric number");
  return value;
}

export function terminalStatus(error) {
  if (error?.name === "AbortError") return "cancelled";
  if (error?.name === "TimeoutError" || error?.code === "engine_timeout" || error?.code === "timeout") return "timeout";
  return "error";
}

export function isSuccessfulGroundedMetric(metric) {
  return metric.requestType === "docs_assistant"
    && metric.status === "ok"
    && metric.sourceCount > 0
    && metric.groundedSuccess === true
    && metric.abstention !== true
    && metric.evaluationFailure !== true
    && metric.monitoringFailure !== true;
}

export function costPerSuccessfulGroundedAnswer(metrics) {
  const assistant = metrics.filter(({ requestType }) => requestType === "docs_assistant");
  const cost = assistant.reduce((total, metric) => total + (Number(metric.estimatedCost) || 0), 0);
  const successes = assistant.filter(isSuccessfulGroundedMetric).length;
  return successes ? cost / successes : null;
}

export async function recordRequestMetric({ db, metric }) {
  if (!metric || !REQUEST_TYPES.has(metric.requestType) || !STATUSES.has(metric.status)) throw new Error("invalid request metric");
  return db.requestMetric.create({
    data: {
      requestId: boundedString(metric.requestId, 64),
      providerRequestId: boundedString(metric.providerRequestId),
      requestType: metric.requestType,
      model: boundedString(metric.model),
      status: metric.status,
      errorType: boundedString(metric.errorType),
      subjectIpHmac: boundedString(metric.subjectIpHmac),
      subjectSessionHmac: boundedString(metric.subjectSessionHmac),
      identifierKeyVersion: optionalNonnegative(metric.identifierKeyVersion, 1_000_000),
      inputTokens: optionalNonnegative(metric.inputTokens, 1_000_000),
      outputTokens: optionalNonnegative(metric.outputTokens, 1_000_000),
      estimatedCost: metric.estimatedCost == null
        ? null
        : Number.isFinite(metric.estimatedCost) && metric.estimatedCost >= 0
          ? metric.estimatedCost.toFixed(8)
          : (() => { throw new Error("invalid metric cost"); })(),
      configRateLatencyMs: optionalNonnegative(metric.configRateLatencyMs, 45_000),
      retrievalLatencyMs: optionalNonnegative(metric.retrievalLatencyMs, 45_000),
      firstByteLatencyMs: optionalNonnegative(metric.firstByteLatencyMs, 45_000),
      totalLatencyMs: optionalNonnegative(metric.totalLatencyMs, 45_000),
      sourceCount: optionalNonnegative(metric.sourceCount, 5),
      abstention: Boolean(metric.abstention),
      groundedSuccess: Boolean(metric.groundedSuccess),
      evaluationFailure: Boolean(metric.evaluationFailure),
      monitoringFailure: Boolean(metric.monitoringFailure),
    },
  });
}

export async function recordRequestMetricBestEffort({ db, metric, logger = console }) {
  try {
    return await recordRequestMetric({ db, metric });
  } catch {
    logger.error("assistant metric write failed");
    return null;
  }
}
