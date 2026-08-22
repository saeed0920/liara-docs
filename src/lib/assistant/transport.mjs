import { createEventSequenceValidator } from "./contract.mjs";

const SESSION_KEY = "liara-docs-assistant:session:v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_FRAME_BYTES = 64 * 1024;

export function assistantSessionId(
  storage = globalThis.sessionStorage,
  create = () => globalThis.crypto.randomUUID(),
) {
  try {
    const current = storage.getItem(SESSION_KEY);
    if (UUID.test(current ?? "")) return current;
    const next = create();
    if (!UUID.test(next)) throw new Error("invalid generated UUID");
    storage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return create();
  }
}

export function boundedHistory(messages) {
  const history = [];
  let characters = 0;
  for (const message of [...messages].reverse()) {
    if (!["user", "assistant"].includes(message?.role) || typeof message.content !== "string") continue;
    const content = message.content.trim().slice(0, 2_000);
    if (!content || characters + content.length > 12_000 || history.length === 10) continue;
    history.unshift({ role: message.role, content });
    characters += content.length;
  }
  return history;
}

function normalizeEvent(type, data) {
  if (type === "meta") return { type, ...data };
  if (type === "sources") return { type, sources: data };
  if (type === "delta") return { type, ...data };
  if (type === "suggestions") return { type, suggestions: data };
  if (type === "done") return { type, ...data };
  if (type === "error") return { type, ...data };
  throw new Error("assistant SSE event type invalid");
}

function parseFrame(frame) {
  if (new TextEncoder().encode(frame).byteLength > MAX_FRAME_BYTES) throw new Error("assistant SSE frame too large");
  if (frame.split(/\r?\n/u).every((line) => !line || line.startsWith(":"))) return null;
  const events = [];
  const data = [];
  for (const line of frame.split(/\r?\n/u)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) events.push(line.slice(6).trim());
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    else throw new Error("assistant SSE field invalid");
  }
  if (events.length !== 1 || data.length !== 1) throw new Error("assistant SSE frame invalid");
  let value;
  try { value = JSON.parse(data[0]); }
  catch { throw new Error("assistant SSE JSON invalid"); }
  return normalizeEvent(events[0], value);
}

async function boundedError(response) {
  if (!response.body?.getReader) throw new Error("assistant error response missing");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_FRAME_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("assistant error response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("assistant error response encoding invalid"); }
  try {
    const value = JSON.parse(text);
    return {
      code: typeof value?.code === "string" ? value.code : "UPSTREAM_FAILED",
      requestId: typeof value?.requestId === "string" ? value.requestId : "unavailable",
    };
  } catch {
    return { code: "UPSTREAM_FAILED", requestId: "unavailable" };
  }
}

export async function* realTransport(request, { signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl("/api/docs-query/", {
    method: "POST",
    signal,
    headers: { accept: "text/event-stream", "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const sequence = createEventSequenceValidator();
  if (!response.ok) {
    const failure = await boundedError(response);
    yield sequence.push({ type: "meta", requestId: failure.requestId, model: "unavailable" });
    yield sequence.push({
      type: "error",
      ...failure,
      retryable: response.status === 429 || response.status >= 500,
    });
    sequence.end();
    return;
  }
  if (!/^text\/event-stream(?:;|$)/i.test(response.headers.get("content-type") ?? "") || !response.body?.getReader) {
    throw new Error("assistant response is not an SSE stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let totalBytes = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) throw new Error("assistant response too large");
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const separator = /\r?\n\r?\n/u.exec(buffer);
        if (!separator) break;
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const event = parseFrame(frame);
        if (event) yield sequence.push(event);
      }
      if (new TextEncoder().encode(buffer).byteLength > MAX_FRAME_BYTES) throw new Error("assistant SSE buffer too large");
    }
    buffer += decoder.decode();
    if (buffer.trim()) throw new Error("assistant SSE stream truncated");
    sequence.end();
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
