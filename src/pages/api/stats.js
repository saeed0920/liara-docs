import { Prisma } from "@prisma/client";
import { db, getConfig } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { parseDashboardFilters, safeMetricDetail } from "@/lib/assistant/dashboard.mjs";

const number = (value) => Number(value ?? 0);

async function readiness() {
  let engine = false;
  let qdrant = false;
  if (process.env.ENGINE_URL) {
    try {
      const response = await fetch(`${process.env.ENGINE_URL.replace(/\/$/, "")}/ready`, {
        redirect: "error",
        signal: AbortSignal.timeout(1_000),
      });
      const value = response.ok ? await response.json() : {};
      engine = value.process === true;
      qdrant = value.qdrant === true && value.active_collection === true;
    } catch {}
  }
  const config = await getConfig();
  return { engine, qdrant, avalaiConfiguration: Boolean(config.avalaiKeyEnc) };
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  let filters;
  try {
    filters = parseDashboardFilters(req.query);
  } catch {
    return res.status(400).json({ error: "invalid filters" });
  }
  const since = new Date(Date.now() - filters.days * 86_400_000);
  const conditions = [Prisma.sql`"createdAt" >= ${since}`];
  if (filters.status !== "all") conditions.push(Prisma.sql`"status" = ${filters.status}`);
  if (filters.model) conditions.push(Prisma.sql`"model" = ${filters.model}`);
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

  const [summary, latency, costEfficiency, daily, models, release, dependencies, detail] = await Promise.all([
    db.$queryRaw`
      SELECT "requestType",
        count(*) AS requests,
        count(*) FILTER (WHERE status = 'ok') AS ok,
        count(*) FILTER (WHERE status = 'error') AS errors,
        count(*) FILTER (WHERE status = 'timeout') AS timeouts,
        count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
        count(*) FILTER (WHERE "errorType" = 'rate_limited' OR status = 'rate_limited') AS rate_limited,
        sum(COALESCE("inputTokens", "promptTokens", 0) + COALESCE("outputTokens", "completionTokens", 0)) AS tokens,
        sum(COALESCE("estimatedCost"::double precision, "costEstimate", 0)) AS cost,
        avg(COALESCE("sourceCount", 0)) AS average_sources,
        count(*) FILTER (WHERE abstention = true) AS abstentions
      FROM "RequestMetric" ${where}
      GROUP BY "requestType"`,
    db.$queryRaw`
      SELECT "requestType",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "retrievalLatencyMs") FILTER (WHERE "retrievalLatencyMs" IS NOT NULL) AS retrieval_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "retrievalLatencyMs") FILTER (WHERE "retrievalLatencyMs" IS NOT NULL) AS retrieval_p95,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "firstByteLatencyMs") FILTER (WHERE "firstByteLatencyMs" IS NOT NULL) AS first_byte_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "firstByteLatencyMs") FILTER (WHERE "firstByteLatencyMs" IS NOT NULL) AS first_byte_p95,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE("totalLatencyMs", "latencyMs")) AS total_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE("totalLatencyMs", "latencyMs")) AS total_p95
      FROM "RequestMetric" ${where}
      GROUP BY "requestType"`,
    db.$queryRaw`
      SELECT
        sum(COALESCE("estimatedCost"::double precision, "costEstimate", 0)) AS total_cost,
        count(*) FILTER (
          WHERE status = 'ok'
            AND "sourceCount" > 0
            AND "groundedSuccess" = true
            AND abstention = false
            AND "evaluationFailure" = false
            AND "monitoringFailure" = false
        ) AS grounded_successes
      FROM "RequestMetric" ${where} AND "requestType" = 'docs_assistant'`,
    db.$queryRaw`
      SELECT date_trunc('day', "createdAt") AS day, "requestType",
        count(*) AS requests,
        count(*) FILTER (WHERE status = 'error') AS errors,
        count(*) FILTER (WHERE "errorType" = 'rate_limited' OR status = 'rate_limited') AS rate_limited,
        sum(COALESCE("inputTokens", "promptTokens", 0) + COALESCE("outputTokens", "completionTokens", 0)) AS tokens,
        sum(COALESCE("estimatedCost"::double precision, "costEstimate", 0)) AS cost
      FROM "RequestMetric" ${where}
      GROUP BY day, "requestType" ORDER BY day ASC`,
    db.requestMetric.findMany({ where: { createdAt: { gte: since }, model: { not: null } }, distinct: ["model"], select: { model: true }, take: 100 }),
    db.assistantReleaseState.findUnique({ where: { id: 1 } }),
    readiness(),
    filters.requestId
      ? db.requestMetric.findUnique({ where: { requestId: filters.requestId } })
      : Promise.resolve(null),
  ]);

  return res.json({
    filters,
    summary: summary.map((row) => ({
      requestType: row.requestType,
      requests: number(row.requests),
      ok: number(row.ok),
      errors: number(row.errors),
      timeouts: number(row.timeouts),
      cancelled: number(row.cancelled),
      rateLimited: number(row.rate_limited),
      tokens: number(row.tokens),
      cost: number(row.cost),
      abstentions: number(row.abstentions),
      averageSources: number(row.average_sources),
    })),
    latency: latency.map((row) => ({
      requestType: row.requestType,
      retrieval: { p50: number(row.retrieval_p50), p95: number(row.retrieval_p95) },
      firstByte: { p50: number(row.first_byte_p50), p95: number(row.first_byte_p95) },
      total: { p50: number(row.total_p50), p95: number(row.total_p95) },
    })),
    costEfficiency: {
      totalAssistantProviderCost: number(costEfficiency[0]?.total_cost),
      successfulGroundedAnswers: number(costEfficiency[0]?.grounded_successes),
      costPerSuccessfulGroundedAnswer: number(costEfficiency[0]?.grounded_successes)
        ? number(costEfficiency[0]?.total_cost) / number(costEfficiency[0]?.grounded_successes)
        : null,
    },
    daily: daily.map((row) => ({
      day: row.day,
      requestType: row.requestType,
      requests: number(row.requests),
      errors: number(row.errors),
      rateLimited: number(row.rate_limited),
      tokens: number(row.tokens),
      cost: number(row.cost),
    })),
    models: models.map(({ model }) => model),
    readiness: dependencies,
    release: release && {
      ingestionStatus: release.ingestionStatus,
      evaluationStatus: release.evaluationStatus,
      activeCollection: release.activeCollection,
      corpusDigest: release.corpusDigest,
      recallAt5: release.recallAt5,
      abstentionPrecision: release.abstentionPrecision,
      updatedAt: release.updatedAt,
    },
    detail: safeMetricDetail(detail),
  });
}
