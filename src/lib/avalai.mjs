import { performance } from "node:perf_hooks";
import { decrypt } from "./crypto.mjs";

const DEFAULT_HOSTS = ["api.avalai.ir"];
const DEFAULT_MODELS = ["gpt-4o-mini"];

function allowlist(value, fallback) {
  const values = (value ? value.split(",") : fallback).map((item) => item.trim()).filter(Boolean);
  if (!values.length) throw new Error("provider allowlist is empty");
  return new Set(values);
}

export function normalizeAvalaiConfig({ baseUrl, model }, env = process.env) {
  const url = new URL(baseUrl);
  const hosts = allowlist(env.AVALAI_ALLOWED_HOSTS, DEFAULT_HOSTS);
  const models = allowlist(env.AVALAI_ALLOWED_MODELS, DEFAULT_MODELS);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.port && url.port !== "443")
    || url.search
    || url.hash
    || url.pathname.replace(/\/+$/, "") !== "/v1"
    || !hosts.has(url.hostname)
  ) throw new Error("AvalAI base URL is not allowed");
  if (!models.has(model)) throw new Error("AvalAI model is not allowed");
  return Object.freeze({ baseUrl: `https://${url.hostname}/v1`, model });
}

function boundedMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12) throw new Error("invalid AvalAI messages");
  let total = 0;
  return messages.map((message) => {
    if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string" || !message.content) throw new Error("invalid AvalAI message");
    total += message.content.length;
    if (message.content.length > 28_000 || total > 32_000) throw new Error("AvalAI messages exceed budget");
    return { role: message.role, content: message.content };
  });
}

function safeHeader(value, max = 128) {
  return typeof value === "string" && value.length <= max && /^[\w.:/-]+$/.test(value) ? value : undefined;
}

function retryAfter(value) {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 3600 ? seconds : undefined;
}

export function safeProviderMetadata(response) {
  return Object.freeze({
    status: response.status,
    requestId: safeHeader(response.headers.get("avalai-request-id")),
    retryAfter: retryAfter(response.headers.get("retry-after")),
  });
}

function linkedDeadline(signal, deadlineMs, clock) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? new DOMException("Aborted", "AbortError"));
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timer;
  const setDeadline = (value) => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new DOMException("Deadline exceeded", "TimeoutError")),
      Math.max(0, value - clock()),
    );
  };
  setDeadline(deadlineMs);
  return {
    signal: controller.signal,
    setDeadline,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

export class AvalaiStreamError extends Error {
  constructor(code) {
    super(code);
    this.name = "AvalaiStreamError";
    this.code = code;
  }
}

export class AvalaiProviderError extends Error {
  constructor(metadata) {
    super("AvalAI request failed");
    this.name = "AvalaiProviderError";
    this.status = metadata.status;
    this.requestId = metadata.requestId;
    this.retryAfter = metadata.retryAfter;
  }
}

export async function requestAvalai({
  config,
  messages,
  maxTokens = 800,
  signal,
  deadlineMs = performance.now() + 10_000,
  clock = () => performance.now(),
  fetchImpl = fetch,
  env = process.env,
}) {
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 800) throw new Error("invalid AvalAI output limit");
  if (!config?.avalaiKeyEnc) throw new Error("AvalAI key is not configured");
  const provider = normalizeAvalaiConfig({ baseUrl: config.avalaiBaseUrl, model: config.defaultModel }, env);
  const deadline = linkedDeadline(signal, deadlineMs, clock);
  try {
    const response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      redirect: "error",
      signal: deadline.signal,
      headers: {
        authorization: `Bearer ${decrypt(config.avalaiKeyEnc, env)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: boundedMessages(messages),
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    normalizeAvalaiConfig({ baseUrl: new URL(response.url).origin + "/v1", model: provider.model }, env);
    return {
      response,
      metadata: safeProviderMetadata(response),
      signal: deadline.signal,
      setDeadline: deadline.setDeadline,
      dispose: deadline.dispose,
    };
  } catch (error) {
    deadline.dispose();
    throw error;
  }
}

const MAX_SSE_FRAME_BYTES = 64 * 1024;
const MAX_SSE_BUFFER_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function parseUsage(value) {
  if (!value || typeof value !== "object") return undefined;
  const inputTokens = value.prompt_tokens;
  const outputTokens = value.completion_tokens;
  const totalTokens = value.total_tokens;
  for (const tokens of [inputTokens, outputTokens, totalTokens]) {
    if (tokens != null && (!Number.isInteger(tokens) || tokens < 0 || tokens > 1_000_000)) throw new AvalaiStreamError("invalid_usage");
  }
  if (outputTokens != null && outputTokens > 800) throw new AvalaiStreamError("output_token_limit");
  return { inputTokens, outputTokens, totalTokens };
}

function parseFrame(frame) {
  if (byteLength(frame) > MAX_SSE_FRAME_BYTES) throw new AvalaiStreamError("frame_limit");
  const lines = frame.split(/\r?\n/);
  const data = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (!line.startsWith("data:")) throw new AvalaiStreamError("unsupported_sse_field");
    data.push(line.slice(5).trimStart());
  }
  if (data.length !== 1) throw new AvalaiStreamError("invalid_sse_frame");
  if (data[0] === "[DONE]") return { done: true };
  let value;
  try { value = JSON.parse(data[0]); }
  catch { throw new AvalaiStreamError("malformed_provider_json"); }
  if (!value || !Array.isArray(value.choices) || value.choices.length > 1) throw new AvalaiStreamError("invalid_provider_event");
  const choice = value.choices[0];
  const delta = choice?.delta;
  if (delta?.tool_calls || delta?.function_call) throw new AvalaiStreamError("unsupported_provider_tool");
  if (delta?.content != null && typeof delta.content !== "string") throw new AvalaiStreamError("invalid_provider_delta");
  const finishReason = choice?.finish_reason;
  if (finishReason != null && typeof finishReason !== "string") throw new AvalaiStreamError("invalid_finish_reason");
  return {
    text: delta?.content || "",
    finishReason: finishReason || undefined,
    usage: parseUsage(value.usage),
    model: safeHeader(value.model),
  };
}

export async function* parseAvalaiSse(body, { signal, onFirstByte = () => {} } = {}) {
  if (!body?.getReader) throw new AvalaiStreamError("missing_provider_stream");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputBytes = 0;
  let finished = false;
  let firstByte = false;
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstByte && value?.byteLength) {
        firstByte = true;
        onFirstByte();
      }
      buffer += decoder.decode(value, { stream: true });
      if (byteLength(buffer) > MAX_SSE_BUFFER_BYTES) throw new AvalaiStreamError("buffer_limit");
      for (;;) {
        const separator = /\r?\n\r?\n/.exec(buffer);
        if (!separator) break;
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        if (!frame.trim()) continue;
        if (finished) throw new AvalaiStreamError("event_after_done");
        const event = parseFrame(frame);
        if (event.done) {
          finished = true;
          continue;
        }
        if (event.text) {
          outputBytes += byteLength(event.text);
          if (outputBytes > MAX_OUTPUT_BYTES) throw new AvalaiStreamError("output_limit");
          yield { type: "delta", text: event.text };
        }
        if (event.usage) yield { type: "usage", usage: event.usage, model: event.model, finishReason: event.finishReason };
        else if (event.finishReason) yield { type: "finish", finishReason: event.finishReason };
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) throw new AvalaiStreamError("truncated_sse_frame");
    if (!finished) throw new AvalaiStreamError("missing_done");
    yield { type: "done" };
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

export async function* streamAvalai({
  totalDeadlineMs = performance.now() + 45_000,
  firstByteTimeoutMs = 10_000,
  maxRetries = 2,
  random = Math.random,
  sleep = defaultSleep,
  clock = () => performance.now(),
  ...request
}) {
  const firstByteDeadlineMs = Math.min(totalDeadlineMs, clock() + firstByteTimeoutMs);
  for (let attempt = 0; ; attempt += 1) {
    if (request.signal?.aborted) throw request.signal.reason;
    const result = await requestAvalai({ ...request, deadlineMs: firstByteDeadlineMs, clock });
    const retryable = result.metadata.status === 429 || result.metadata.status >= 500;
    if (!result.response.ok) {
      await result.response.body?.cancel?.().catch(() => {});
      result.dispose();
      if (!retryable || attempt >= maxRetries) throw new AvalaiProviderError(result.metadata);
      const delay = Math.ceil(100 * 2 ** attempt * (0.5 + random()));
      if (clock() + delay >= firstByteDeadlineMs || clock() + delay >= totalDeadlineMs) throw new DOMException("Deadline exceeded", "TimeoutError");
      await sleep(delay, request.signal);
      if (request.signal?.aborted) throw request.signal.reason;
      continue;
    }
    try {
      for await (const event of parseAvalaiSse(result.response.body, {
        signal: result.signal,
        onFirstByte: () => result.setDeadline(totalDeadlineMs),
      })) yield { ...event, metadata: result.metadata };
      return;
    } finally {
      result.dispose();
    }
  }
}
