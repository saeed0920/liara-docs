const STATUSES = new Set(["all", "ok", "error", "timeout", "cancelled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDashboardFilters(query) {
  const days = Number(query.days ?? 7);
  const status = query.status ?? "all";
  const model = query.model ?? "";
  const requestId = query.requestId ?? "";
  if (![1, 7, 30, 90].includes(days) || !STATUSES.has(status) || typeof model !== "string" || model.length > 128 || (model && !/^[\w.:-]+$/.test(model)) || typeof requestId !== "string" || (requestId && !UUID.test(requestId))) throw new Error("invalid dashboard filters");
  return { days, status, model, requestId };
}

export function safeMetricDetail(row) {
  if (!row) return null;
  return {
    requestId: row.requestId,
    providerRequestId: row.providerRequestId,
    requestType: row.requestType,
    model: row.model,
    status: row.status,
    errorType: row.errorType,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    estimatedCost: row.estimatedCost == null ? null : Number(row.estimatedCost),
    configRateLatencyMs: row.configRateLatencyMs,
    retrievalLatencyMs: row.retrievalLatencyMs,
    firstByteLatencyMs: row.firstByteLatencyMs,
    totalLatencyMs: row.totalLatencyMs,
    sourceCount: row.sourceCount,
    abstention: row.abstention,
    groundedSuccess: row.groundedSuccess,
    createdAt: row.createdAt,
  };
}
