// ponytail: in-memory sliding-window rate limit, single instance only.
// Move to Redis if the app runs multiple replicas.

const LIMIT = 5;
const WINDOW_MS = 60_000;

const g = globalThis;
const hits = g.__rateHits ?? new Map();
g.__rateHits = hits;

// Returns true if allowed, false if over limit.
export function allow(uuid) {
  const now = Date.now();
  const arr = (hits.get(uuid) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) {
    hits.set(uuid, arr);
    return false;
  }
  arr.push(now);
  hits.set(uuid, arr);
  return true;
}
