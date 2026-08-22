import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  cleanupExpiredRateLimitBuckets,
  consumeAssistantQuota,
  RateLimitExceeded,
  RateLimitUnavailable,
} from "../src/lib/assistant/rate-limit.mjs";

const input = {
  ip: "203.0.113.77",
  sessionId: "c21f969b-5f03-43ad-9f4a-1030b1f1f09f",
  secret: "two-process-test-hmac-key-32-bytes-minimum",
  keyVersion: 1,
  minuteLimit: 1,
  dayLimit: 1,
  now: new Date("2026-08-21T18:03:42.000Z"),
};

if (process.argv[2] === "worker") {
  const db = new PrismaClient();
  process.send?.("ready");
  process.once("message", async () => {
    try {
      await consumeAssistantQuota({ db, ...input, deadlineMs: performance.now() + 5_000 });
      process.send?.("admitted");
    } catch (error) {
      process.send?.(error instanceof RateLimitExceeded ? "limited" : `error:${error.name}`);
    } finally {
      await db.$disconnect();
      process.exit();
    }
  });
} else {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const db = new PrismaClient();
  await db.rateLimitBucket.deleteMany();
  const workers = [0, 1].map(() => fork(fileURLToPath(import.meta.url), ["worker"], {
    env: process.env,
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  }));
  await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", (message) => message === "ready" && resolve());
  })));
  const outcomes = await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", resolve);
    worker.send("go");
  })));
  assert.deepEqual(outcomes.sort(), ["admitted", "limited"]);

  const rows = await db.rateLimitBucket.findMany({ orderBy: [{ domain: "asc" }, { windowKind: "asc" }] });
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.count === 1));
  assert.ok(rows.every((row) => row.windowStart.getUTCSeconds() === 0 && row.windowStart.getUTCMilliseconds() === 0));
  await assert.rejects(
    () => consumeAssistantQuota({ db, ...input }),
    (error) => error instanceof RateLimitExceeded && error.retryAfter > 60,
  );
  assert.ok((await db.rateLimitBucket.findMany()).every((row) => row.count === 1));

  await db.rateLimitBucket.updateMany({ data: { expiresAt: new Date(0) } });
  assert.equal((await cleanupExpiredRateLimitBuckets({ db })).count, 4);

  const outage = new PrismaClient({ datasources: { db: { url: "postgresql://bad:bad@127.0.0.1:1/bad?connect_timeout=1" } } });
  await assert.rejects(
    () => consumeAssistantQuota({ db: outage, ...input, maxRetries: 0 }),
    RateLimitUnavailable,
  );
  await outage.$disconnect();
  await db.$disconnect();
  console.log(JSON.stringify({ twoProcessFinalAllowance: "pass", rollback: "pass", alignedWindows: "pass", cleanup: "pass", outageFailClosed: "pass" }));
}
