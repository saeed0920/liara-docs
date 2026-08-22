import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { streamAvalai } from "@/lib/avalai.mjs";
import { getAssistantConfig } from "@/lib/assistant/config-server.mjs";
import { validateLegacyChat } from "@/lib/assistant/legacy-chat.mjs";
import { recordRequestMetric } from "@/lib/assistant/observability.mjs";
import { consumeAssistantQuota, hmacSubject, RateLimitExceeded, RateLimitUnavailable } from "@/lib/assistant/rate-limit.mjs";
import { trustedClientIp } from "@/lib/assistant/request-context.mjs";
import { loadAssistantHmacKey } from "@/lib/assistant/runtime-secrets.mjs";
import { db } from "@/lib/db";
import { estimateCost } from "@/lib/pricing";

const SYSTEM_MESSAGE = "You are a concise assistant. Never reveal secrets or claim actions you did not perform.";

async function metric(value) {
  try { await recordRequestMetric({ db, metric: value }); }
  catch { console.error("chat metric write failed"); }
}

export default async function handler(req, res) {
  const requestId = randomUUID();
  const started = performance.now();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  let body;
  try { body = validateLegacyChat(req.body); }
  catch { return res.status(400).json({ code: "invalid_request", requestId }); }

  let config;
  let hmac;
  let ip;
  try {
    config = await getAssistantConfig();
    hmac = loadAssistantHmacKey();
    ip = trustedClientIp(req.headers);
    await consumeAssistantQuota({
      db,
      ip,
      sessionId: body.clientUuid,
      secret: hmac.key,
      keyVersion: hmac.version,
      minuteLimit: config.assistantMinuteLimit,
      dayLimit: config.assistantDayLimit,
      hmacDomain: "chat",
      deadlineMs: performance.now() + 1_000,
    });
  } catch (error) {
    if (error instanceof RateLimitExceeded) {
      await metric({
        requestId,
        requestType: "chat",
        model: config?.defaultModel,
        status: "error",
        errorType: "rate_limited",
        subjectIpHmac: hmac && ip ? hmacSubject(hmac.key, "chat_ip", ip) : undefined,
        subjectSessionHmac: hmac ? hmacSubject(hmac.key, "chat_session", body.clientUuid) : undefined,
        identifierKeyVersion: hmac?.version,
        configRateLatencyMs: Math.round(performance.now() - started),
        totalLatencyMs: Math.round(performance.now() - started),
        sourceCount: 0,
      });
      res.setHeader("Retry-After", String(error.retryAfter));
      return res.status(429).json({ code: "rate_limited", requestId });
    }
    return res.status(503).json({ code: "unavailable", requestId });
  }
  const configRateLatencyMs = Math.round(performance.now() - started);
  const metricBase = {
    requestId,
    requestType: "chat",
    model: config.defaultModel,
    subjectIpHmac: hmacSubject(hmac.key, "chat_ip", ip),
    subjectSessionHmac: hmacSubject(hmac.key, "chat_session", body.clientUuid),
    identifierKeyVersion: hmac.version,
    configRateLatencyMs,
    sourceCount: 0,
  };
  if (!config.avalaiKeyEnc) {
    await metric({
      ...metricBase,
      status: "error",
      errorType: "provider_unconfigured",
      totalLatencyMs: Math.round(performance.now() - started),
    });
    return res.status(503).json({ code: "provider_unconfigured", requestId });
  }

  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) controller.abort(new DOMException("Disconnected", "AbortError"));
  });
  const iterator = streamAvalai({
    config,
    messages: [{ role: "system", content: SYSTEM_MESSAGE }, ...body.messages],
    maxTokens: 800,
    signal: controller.signal,
    totalDeadlineMs: performance.now() + 30_000,
    firstByteTimeoutMs: 10_000,
  })[Symbol.asyncIterator]();

  let first;
  let firstByteLatencyMs;
  try {
    first = await iterator.next();
    firstByteLatencyMs = Math.round(performance.now() - started);
  } catch (error) {
    const status = error?.name === "TimeoutError" ? 504 : 502;
    await metric({
      ...metricBase,
      providerRequestId: error?.requestId,
      status: status === 504 ? "timeout" : "error",
      errorType: status === 504 ? "provider_timeout" : "provider_error",
      totalLatencyMs: Math.round(performance.now() - started),
    });
    return res.status(status).json({ code: status === 504 ? "timeout" : "provider_error", requestId });
  }

  let text = "";
  let usage;
  let providerRequestId;
  const accept = (event) => {
    providerRequestId ||= event.metadata?.requestId;
    if (event.type === "delta") text += event.text;
    if (event.type === "usage") usage = event.usage;
  };
  accept(first.value);

  if (!body.stream) {
    try {
      for (;;) {
        const item = await iterator.next();
        if (item.done) break;
        accept(item.value);
      }
      await metric({
        ...metricBase,
        providerRequestId,
        status: "ok",
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        estimatedCost: estimateCost(config.defaultModel, usage?.inputTokens, usage?.outputTokens),
        firstByteLatencyMs,
        totalLatencyMs: Math.round(performance.now() - started),
      });
      return res.json({ message: text, model: config.defaultModel, usage: usage ?? null, requestId });
    } catch (error) {
      const status = error?.name === "TimeoutError" ? 504 : 502;
      await metric({
        ...metricBase,
        providerRequestId,
        status: status === 504 ? "timeout" : error?.name === "AbortError" ? "cancelled" : "error",
        errorType: status === 504 ? "provider_timeout" : error?.name === "AbortError" ? "cancelled" : "provider_stream_error",
        firstByteLatencyMs,
        totalLatencyMs: Math.round(performance.now() - started),
      });
      return res.status(status).json({ code: status === 504 ? "timeout" : "provider_error", requestId });
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const write = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  try {
    if (first.value?.type === "delta") write({ delta: first.value.text });
    for (;;) {
      const item = await iterator.next();
      if (item.done) break;
      accept(item.value);
      if (item.value.type === "delta") write({ delta: item.value.text });
    }
    write({ done: true, usage: usage ?? null, requestId });
    await metric({
      ...metricBase,
      providerRequestId,
      status: "ok",
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      estimatedCost: estimateCost(config.defaultModel, usage?.inputTokens, usage?.outputTokens),
      firstByteLatencyMs,
      totalLatencyMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    const status = error?.name === "TimeoutError" ? "timeout" : error?.name === "AbortError" ? "cancelled" : "error";
    write({ error: { code: status === "timeout" ? "timeout" : status === "cancelled" ? "cancelled" : "provider_error", requestId } });
    await metric({
      ...metricBase,
      providerRequestId,
      status,
      errorType: status === "error" ? "provider_stream_error" : status,
      firstByteLatencyMs,
      totalLatencyMs: Math.round(performance.now() - started),
    });
  } finally {
    res.end();
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: "16kb" },
    responseLimit: false,
  },
};
