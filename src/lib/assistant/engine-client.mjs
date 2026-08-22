import { performance } from "node:perf_hooks";
import { loadEngineTokens } from "./runtime-secrets.mjs";

const IDS = new Set(["S1", "S2", "S3", "S4", "S5"]);
const SOURCE_FIELDS = new Set(["id", "title", "url", "anchor", "filename", "startLine", "endLine", "text"]);

export class EngineClientError extends Error {
  constructor(code) {
    super(code);
    this.name = "EngineClientError";
    this.code = code;
  }
}

async function boundedJson(response, limit = 128 * 1024) {
  if (!response.body?.getReader) throw new EngineClientError("engine_invalid_response");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new EngineClientError("engine_response_too_large");
    }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks.map((value) => Buffer.from(value))))); }
  catch { throw new EngineClientError("engine_invalid_response"); }
}

function validSource(value) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === SOURCE_FIELDS.size
    && Object.keys(value).every((key) => SOURCE_FIELDS.has(key))
    && IDS.has(value.id)
    && typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 200
    && typeof value.url === "string" && /^\/[a-z0-9/_-]*$/i.test(value.url) && !value.url.startsWith("//") && !value.url.split("/").includes("..")
    && typeof value.anchor === "string" && value.anchor.length <= 200 && !/[#?/\\\s]/u.test(value.anchor)
    && typeof value.filename === "string" && /^[a-z0-9/_-]+\.(?:md|mdx)$/i.test(value.filename) && !value.filename.split("/").includes("..")
    && Number.isInteger(value.startLine) && value.startLine > 0
    && Number.isInteger(value.endLine) && value.endLine >= value.startLine
    && typeof value.text === "string" && value.text.trim().length > 0;
}

export function projectEngineResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["insufficient_context", "sources"].includes(key)) || typeof value.insufficient_context !== "boolean" || !Array.isArray(value.sources)) throw new EngineClientError("engine_invalid_response");
  if (value.insufficient_context) return { insufficientContext: true, sources: [], context: "" };
  const seen = new Set();
  const sources = [];
  let contextLength = 0;
  const contextParts = [];
  for (const source of value.sources) {
    if (!validSource(source)) continue;
    const target = `${source.url}#${source.anchor}`;
    if (seen.has(source.id) || seen.has(target)) continue;
    const prefix = `[SOURCE ${source.id} BEGIN]\n${JSON.stringify({ title: source.title.trim(), url: source.url, anchor: source.anchor })}\n`;
    const suffix = `\n[SOURCE ${source.id} END]`;
    const separatorLength = contextParts.length ? 1 : 0;
    const remaining = 12_000 - contextLength - separatorLength - prefix.length - suffix.length;
    if (remaining <= 0) break;
    const text = source.text.slice(0, remaining);
    const contextPart = `${prefix}${text}${suffix}`;
    contextLength += separatorLength + contextPart.length;
    contextParts.push(contextPart);
    seen.add(source.id);
    seen.add(target);
    sources.push({
      id: source.id,
      title: source.title.trim(),
      url: source.url,
      anchor: source.anchor,
      filename: source.filename,
      startLine: source.startLine,
      endLine: source.endLine,
      text,
      snippet: text.slice(0, 300),
    });
    if (sources.length === 5) break;
  }
  return {
    insufficientContext: sources.length === 0,
    sources,
    context: contextParts.join("\n"),
  };
}

export async function retrieveDocs({
  message,
  pagePath,
  signal,
  deadlineMs,
  clock = () => performance.now(),
  fetchImpl = fetch,
  env = process.env,
}) {
  const base = new URL(env.ENGINE_URL);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname.replace(/\/+$/, "")) throw new EngineClientError("engine_configuration_invalid");
  const timeout = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(8_000, deadlineMs - clock()))));
  const linked = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const token = loadEngineTokens(env).current;
  let response;
  try {
    response = await fetchImpl(`${base.origin}/retrieve`, {
      method: "POST",
      redirect: "error",
      signal: linked,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-request-timeout-ms": String(Math.max(1, Math.floor(deadlineMs - clock()))) },
      body: JSON.stringify({ query: message, page_path: pagePath, limit: 5 }),
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error?.name === "TimeoutError" || timeout.aborted) throw new EngineClientError("engine_timeout");
    throw new EngineClientError("engine_unavailable");
  }
  if (!response.ok || new URL(response.url).origin !== base.origin) throw new EngineClientError("engine_unavailable");
  return projectEngineResponse(await boundedJson(response));
}
