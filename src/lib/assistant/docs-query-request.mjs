const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set(["normal", "tutorial", "command"]);
const ROOT_FIELDS = new Set(["sessionId", "mode", "message", "history", "page"]);

export class PayloadTooLarge extends Error {
  constructor() {
    super("assistant request is too large");
    this.name = "PayloadTooLarge";
  }
}

function exactFields(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => fields.has(key)) && Object.keys(value).length === fields.size;
}

export function validateRequestEnvelope(req, env = process.env) {
  if (req.method !== "POST") throw new Error("invalid method");
  const contentType = req.headers["content-type"] ?? "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) throw new Error("invalid content type");
  const host = req.headers.host;
  const origin = req.headers.origin;
  const hosts = new Set((env.ASSISTANT_ALLOWED_HOSTS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const origins = new Set((env.ASSISTANT_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!hosts.size || !origins.size || !hosts.has(host) || !origins.has(origin)) throw new Error("untrusted origin");
}

export async function readJsonBody(req, limit = 32 * 1024) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new PayloadTooLarge();
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) throw new PayloadTooLarge();
    chunks.push(bytes);
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new Error("invalid JSON encoding"); }
  try { return JSON.parse(text); }
  catch { throw new Error("invalid JSON"); }
}

export function validateDocsQuery(value) {
  if (!exactFields(value, ROOT_FIELDS) || !UUID.test(value.sessionId ?? "") || !MODES.has(value.mode)) throw new Error("invalid docs query");
  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!message || message.length > 2_000 || !Array.isArray(value.history)) throw new Error("invalid docs query");
  if (value.history.length > 10) throw new PayloadTooLarge();
  let historyLength = 0;
  const history = value.history.map((item) => {
    if (!exactFields(item, new Set(["role", "content"])) || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") throw new Error("invalid docs query");
    const content = item.content.trim();
    if (!content || content.length > 2_000) throw new Error("invalid docs query");
    historyLength += content.length;
    return { role: item.role, content };
  });
  if (historyLength > 12_000) throw new PayloadTooLarge();
  if (!exactFields(value.page, new Set(["path", "title"]))) throw new Error("invalid docs query");
  const path = value.page.path;
  const title = typeof value.page.title === "string" ? value.page.title.trim() : "";
  if (typeof path !== "string" || path.length > 500 || !/^\/[a-z0-9/_-]*$/i.test(path) || path.startsWith("//") || path.split("/").includes("..") || title.length > 200) throw new Error("invalid docs query");
  return { sessionId: value.sessionId, mode: value.mode, message, history, page: { path, title } };
}
