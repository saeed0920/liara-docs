function positiveVersion(value, name) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw new Error(`${name} must be a positive integer`);
  return version;
}

export function loadAssistantHmacKey(env = process.env) {
  if (env.ASSISTANT_HMAC_KEY === env.SESSION_SECRET && env.ASSISTANT_HMAC_KEY) throw new Error("assistant HMAC key must be independent of SESSION_SECRET");
  const version = positiveVersion(env.ASSISTANT_HMAC_KEY_CURRENT_VERSION ?? "1", "ASSISTANT_HMAC_KEY_CURRENT_VERSION");
  const key = env[`ASSISTANT_HMAC_KEY_V${version}`] ?? (version === 1 ? env.ASSISTANT_HMAC_KEY : undefined);
  if (!key || Buffer.byteLength(key) < 32) throw new Error(`ASSISTANT_HMAC_KEY_V${version} must be at least 32 bytes`);
  return { key, version };
}

export function loadEngineTokens(env = process.env) {
  const current = env.ENGINE_API_TOKEN;
  const next = env.ENGINE_API_TOKEN_NEXT || undefined;
  if (!current || Buffer.byteLength(current) < 32) throw new Error("ENGINE_API_TOKEN must be at least 32 bytes");
  if (next && (Buffer.byteLength(next) < 32 || next === current)) throw new Error("ENGINE_API_TOKEN_NEXT must be distinct and at least 32 bytes");
  return Object.freeze({ current, next });
}
