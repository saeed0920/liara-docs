import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  const days = Math.min(Number(req.query.days ?? 7) || 7, 90);
  const since = new Date(Date.now() - days * 86_400_000);

  const daily = await db.$queryRaw`
    SELECT date_trunc('day', "createdAt") AS day,
           count(*) AS requests,
           sum("totalTokens") AS tokens,
           sum("costEstimate") AS cost,
           avg("latencyMs") AS avg_latency,
           count(*) FILTER (WHERE status = 'error') AS errors,
           count(*) FILTER (WHERE status = 'rate_limited') AS rate_limited
    FROM "RequestMetric"
    WHERE "createdAt" >= ${since}
    GROUP BY day ORDER BY day ASC;
  `;

  const pct = await db.$queryRaw`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95
    FROM "RequestMetric"
    WHERE "createdAt" >= ${since} AND status = 'ok';
  `;

  const totals = await db.$queryRaw`
    SELECT count(*) AS requests,
           sum("totalTokens") AS tokens,
           sum("costEstimate") AS cost,
           count(DISTINCT "clientUuid") AS users
    FROM "RequestMetric"
    WHERE "createdAt" >= ${since};
  `;

  const t = totals[0] ?? {};
  res.json({
    days,
    daily: daily.map((d) => ({
      day: d.day,
      requests: Number(d.requests),
      tokens: Number(d.tokens ?? 0),
      cost: Number(d.cost ?? 0),
      avgLatency: Math.round(Number(d.avg_latency ?? 0)),
      errors: Number(d.errors),
      rateLimited: Number(d.rate_limited),
    })),
    latency: {
      p50: Math.round(Number(pct[0]?.p50 ?? 0)),
      p95: Math.round(Number(pct[0]?.p95 ?? 0)),
    },
    totals: {
      requests: Number(t.requests ?? 0),
      tokens: Number(t.tokens ?? 0),
      cost: Number(t.cost ?? 0),
      users: Number(t.users ?? 0),
    },
  });
}
