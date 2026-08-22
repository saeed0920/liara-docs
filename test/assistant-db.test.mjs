import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cleanupExpiredRateLimitBuckets,
  consumeAssistantQuota,
  hmacSubject,
  RateLimitExceeded,
  RateLimitUnavailable,
} from "../src/lib/assistant/rate-limit.mjs";

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const migrationPath = new URL("../prisma/migrations/20260821190000_add_assistant_runtime_controls/migration.sql", import.meta.url);

function model(schema, name) {
  return schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] || "";
}

function fakeDatabase() {
  let rows = new Map();
  const order = [];
  const tx = {
    rateLimitBucket: {
      async upsert({ where, create, update }) {
        const key = Object.values(where.domain_subjectHmac_windowKind_windowStart)
          .map((value) => value instanceof Date ? value.toISOString() : value)
          .join("|");
        order.push(`${create.domain}:${create.windowKind}`);
        const current = rows.get(key);
        const row = current
          ? { ...current, count: current.count + update.count.increment, expiresAt: update.expiresAt }
          : { ...create };
        rows.set(key, row);
        return row;
      },
    },
  };
  return {
    order,
    rows: () => [...rows.values()],
    async $transaction(work, options) {
      assert.equal(options.isolationLevel, "Serializable");
      const before = structuredClone(rows);
      try { return await work(tx); }
      catch (error) { rows = before; throw error; }
    },
  };
}

test("assistant migration is additive, disabled, bounded, and privacy-safe", async () => {
  const [schema, sql] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(migrationPath, "utf8"),
  ]);

  assert.match(model(schema, "Config"), /assistantEnabled\s+Boolean\s+@default\(false\)/);
  assert.match(sql, /assistantMinuteLimit[^;]+BETWEEN 1 AND 1000/s);
  assert.match(sql, /assistantDayLimit[^;]+BETWEEN 1 AND 100000/s);
  assert.match(sql, /UNIQUE INDEX "RateLimitBucket_domain_subjectHmac_windowKind_windowStart_key"/);
  assert.match(sql, /INDEX "RateLimitBucket_expiresAt_idx"/);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)/i);

  for (const name of ["RateLimitBucket", "AssistantAudit", "AssistantReleaseState"]) {
    assert.doesNotMatch(model(schema, name), /prompt|history|answer|sourceText|rawIp|rawSession|authorization|secret/i);
  }
  assert.match(model(schema, "RequestMetric"), /requestType/);
  assert.match(model(schema, "RequestMetric"), /retrievalLatencyMs/);
  assert.match(model(schema, "RequestMetric"), /groundedSuccess/);
});

test("four HMAC quota buckets commit and roll back in stable order", async () => {
  const db = fakeDatabase();
  const input = {
    db,
    ip: "203.0.113.9",
    sessionId: "d9428888-122b-11e1-b85c-61cd3cbb3210",
    secret: "test-only-hmac-key",
    keyVersion: 1,
    minuteLimit: 1,
    dayLimit: 10,
    now: new Date("2026-08-21T18:03:42.000Z"),
  };
  const consumed = await consumeAssistantQuota(input);
  assert.deepEqual(db.order, ["ip:day", "ip:minute", "session:day", "session:minute"]);
  assert.equal(consumed.length, 4);
  assert.equal(db.rows().length, 4);
  assert.notEqual(hmacSubject(input.secret, "ip", input.ip), hmacSubject(input.secret, "session", input.ip));
  assert.ok(db.rows().every((row) => !JSON.stringify(row).includes(input.ip) && !JSON.stringify(row).includes(input.sessionId)));

  await assert.rejects(
    () => consumeAssistantQuota({ ...input, dayLimit: 1 }),
    (error) => error instanceof RateLimitExceeded && error.retryAfter > 60,
  );
  assert.ok(db.rows().every((row) => row.count === 1), "failed admission must roll back every increment");
});

test("serialization retries are deadline-bounded and other database errors fail closed", async () => {
  const working = fakeDatabase();
  const transaction = working.$transaction.bind(working);
  let attempts = 0;
  working.$transaction = async (...args) => {
    if (attempts++ === 0) throw Object.assign(new Error("serialization conflict"), { code: "P2034" });
    return transaction(...args);
  };
  const common = {
    db: working,
    ip: "203.0.113.10",
    sessionId: "e902893a-9d22-4f6f-945d-03a9c40b8998",
    secret: "test-only-hmac-key",
    keyVersion: 1,
    minuteLimit: 2,
    dayLimit: 20,
    now: new Date("2026-08-21T18:03:42.000Z"),
    clock: () => 0,
    deadlineMs: 100,
    sleep: async () => {},
  };
  assert.equal((await consumeAssistantQuota(common)).length, 4);
  assert.equal(attempts, 2);

  await assert.rejects(
    () => consumeAssistantQuota({ ...common, db: { $transaction: async () => { throw new Error("offline"); } } }),
    RateLimitUnavailable,
  );
  let cleanupWhere;
  await cleanupExpiredRateLimitBuckets({
    db: { rateLimitBucket: { deleteMany: async ({ where }) => { cleanupWhere = where; return { count: 2 }; } } },
    now: common.now,
  });
  assert.deepEqual(cleanupWhere, { expiresAt: { lt: common.now } });
});
