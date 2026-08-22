import { normalizeAvalaiConfig } from "../avalai.mjs";

const FIELDS = new Set([
  "avalaiKey",
  "avalaiBaseUrl",
  "defaultModel",
  "assistantEnabled",
  "assistantMinuteLimit",
  "assistantDayLimit",
]);

export function validateProviderCandidate(value, env = process.env) {
  const allowed = new Set(["avalaiKey", "avalaiBaseUrl", "defaultModel"]);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.has(key))) throw new Error("invalid provider candidate");
  const provider = normalizeAvalaiConfig({ baseUrl: value.avalaiBaseUrl, model: value.defaultModel }, env);
  if (value.avalaiKey != null && (typeof value.avalaiKey !== "string" || !value.avalaiKey.trim() || value.avalaiKey.length > 512)) throw new Error("invalid provider candidate");
  return { ...provider, avalaiKey: value.avalaiKey?.trim() };
}

export function validateAssistantConfigUpdate(value, env = process.env) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !FIELDS.has(key))) throw new Error("invalid configuration");
  const provider = normalizeAvalaiConfig({ baseUrl: value.avalaiBaseUrl, model: value.defaultModel }, env);
  if (typeof value.assistantEnabled !== "boolean") throw new Error("invalid configuration");
  if (!Number.isInteger(value.assistantMinuteLimit) || value.assistantMinuteLimit < 1 || value.assistantMinuteLimit > 1000) throw new Error("invalid configuration");
  if (!Number.isInteger(value.assistantDayLimit) || value.assistantDayLimit < 1 || value.assistantDayLimit > 100_000) throw new Error("invalid configuration");
  if (value.avalaiKey != null && (typeof value.avalaiKey !== "string" || !value.avalaiKey.trim() || value.avalaiKey.length > 512)) throw new Error("invalid configuration");
  return {
    ...provider,
    assistantEnabled: value.assistantEnabled,
    assistantMinuteLimit: value.assistantMinuteLimit,
    assistantDayLimit: value.assistantDayLimit,
    avalaiKey: value.avalaiKey?.trim(),
  };
}
