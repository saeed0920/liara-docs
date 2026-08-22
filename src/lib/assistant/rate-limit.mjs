import { createHmac } from "node:crypto";
import { performance } from "node:perf_hooks";

export class RateLimitExceeded extends Error {
  constructor(buckets, now) {
    super("assistant rate limit exceeded");
    this.name = "RateLimitExceeded";
    this.retryAfter = Math.max(...buckets.map(({ expiresAt }) => Math.max(1, Math.ceil((expiresAt - now) / 1000))));
  }
}

export class RateLimitUnavailable extends Error {
  constructor() {
    super("assistant rate limiter unavailable");
    this.name = "RateLimitUnavailable";
  }
}

export function hmacSubject(secret, domain, raw) {
  if (!secret || !raw || !["ip", "session", "connection_test", "chat_ip", "chat_session"].includes(domain)) throw new Error("invalid rate-limit subject");
  return createHmac("sha256", secret).update(`assistant-rate:${domain}\0${raw}`).digest("base64url");
}

export function quotaBuckets({ ip, sessionId, secret, keyVersion, minuteLimit, dayLimit, hmacDomain = "assistant", now = new Date() }) {
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || !Number.isInteger(minuteLimit) || minuteLimit < 1 || !Number.isInteger(dayLimit) || dayLimit < 1) throw new Error("invalid assistant rate-limit configuration");
  const minuteStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windows = [
    { windowKind: "day", windowStart: dayStart, expiresAt: new Date(dayStart.getTime() + 86_400_000), limit: dayLimit },
    { windowKind: "minute", windowStart: minuteStart, expiresAt: new Date(minuteStart.getTime() + 60_000), limit: minuteLimit },
  ];
  const ipDomain = hmacDomain === "assistant" ? "ip" : `${hmacDomain}_ip`;
  const sessionDomain = hmacDomain === "assistant" ? "session" : `${hmacDomain}_session`;
  return [
    ...windows.map((window) => ({ domain: "ip", subjectHmac: hmacSubject(secret, ipDomain, ip), ...window })),
    ...windows.map((window) => ({ domain: "session", subjectHmac: hmacSubject(secret, sessionDomain, sessionId), ...window })),
  ];
}

async function consumeOnce(db, buckets, keyVersion, now) {
  return db.$transaction(async (tx) => {
    const consumed = [];
    const exceeded = [];
    for (const bucket of buckets) {
      const { limit, ...identity } = bucket;
      const row = await tx.rateLimitBucket.upsert({
        where: {
          domain_subjectHmac_windowKind_windowStart: {
            domain: identity.domain,
            subjectHmac: identity.subjectHmac,
            windowKind: identity.windowKind,
            windowStart: identity.windowStart,
          },
        },
        create: { ...identity, identifierKeyVersion: keyVersion, count: 1 },
        update: { count: { increment: 1 }, expiresAt: identity.expiresAt, identifierKeyVersion: keyVersion },
      });
      if (row.count > limit) exceeded.push(bucket);
      consumed.push({ ...bucket, count: row.count, remaining: Math.max(0, limit - row.count) });
    }
    if (exceeded.length) throw new RateLimitExceeded(exceeded, now);
    return consumed;
  }, { isolationLevel: "Serializable" });
}

export async function consumeAssistantQuota({
  db,
  ip,
  sessionId,
  secret,
  keyVersion,
  minuteLimit,
  dayLimit,
  hmacDomain = "assistant",
  now = new Date(),
  maxRetries = 2,
  deadlineMs = performance.now() + 1_000,
  clock = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const buckets = quotaBuckets({ ip, sessionId, secret, keyVersion, minuteLimit, dayLimit, hmacDomain, now });
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await consumeOnce(db, buckets, keyVersion, now);
    } catch (error) {
      if (error instanceof RateLimitExceeded) throw error;
      const delay = 10 * (attempt + 1);
      if (error?.code !== "P2034" || attempt >= maxRetries || clock() + delay >= deadlineMs) throw new RateLimitUnavailable();
      await sleep(delay);
    }
  }
}

export async function cleanupExpiredRateLimitBuckets({ db, now = new Date() }) {
  return db.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } });
}
