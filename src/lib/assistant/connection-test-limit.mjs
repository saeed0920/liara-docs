export class ConnectionTestLimitExceeded extends Error {
  constructor(retryAfter) {
    super("connection test limit exceeded");
    this.name = "ConnectionTestLimitExceeded";
    this.retryAfter = retryAfter;
  }
}

export function createConnectionTestLimiter({ limit = 3, windowMs = 300_000, clock = Date.now } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) throw new Error("invalid connection test limit");
  const buckets = new Map();
  return {
    consume(subjectHmac) {
      const now = clock();
      const current = buckets.get(subjectHmac);
      const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
      if (bucket.count >= limit) throw new ConnectionTestLimitExceeded(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      bucket.count += 1;
      buckets.set(subjectHmac, bucket);
      return { remaining: limit - bucket.count };
    },
  };
}
