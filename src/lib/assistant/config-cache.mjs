const CONFIG_FIELDS = [
  "id",
  "avalaiKeyEnc",
  "avalaiKeyVersion",
  "avalaiBaseUrl",
  "defaultModel",
  "assistantEnabled",
  "assistantMinuteLimit",
  "assistantDayLimit",
  "assistantConcurrencyLimit",
  "metricRetentionDays",
  "auditRetentionDays",
  "identifierRotationDays",
  "updatedAt",
];

function snapshot(row) {
  return Object.freeze(Object.fromEntries(CONFIG_FIELDS.map((field) => [field, row[field]])));
}

export function createAssistantConfigCache({ load, ttlMs = 30_000, clock = Date.now }) {
  if (typeof load !== "function" || !Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 30_000) throw new Error("invalid assistant config cache");
  let cached;
  let expiresAt = 0;
  let generation = 0;
  let pending;

  async function get() {
    const now = clock();
    if (cached && now < expiresAt) return cached;
    if (!pending) {
      const startedAt = generation;
      pending = Promise.resolve(load()).then((row) => ({ row, startedAt })).finally(() => { pending = undefined; });
    }
    const { row, startedAt } = await pending;
    if (startedAt !== generation) return get();
    cached = snapshot(row);
    expiresAt = clock() + ttlMs;
    return cached;
  }

  function invalidate() {
    generation += 1;
    cached = undefined;
    expiresAt = 0;
  }

  return { get, invalidate };
}
