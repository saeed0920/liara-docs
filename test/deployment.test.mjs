import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const script = new URL("../scripts/validate-deployment-env.mjs", import.meta.url);
const runtimeEnv = {
  PATH: process.env.PATH,
  DATABASE_URL: "postgresql://user:pass@db.internal:5432/docs",
  ENCRYPTION_KEY_CURRENT_VERSION: "1",
  ENCRYPTION_KEY_V1: "a".repeat(64),
  ASSISTANT_HMAC_KEY_CURRENT_VERSION: "1",
  ASSISTANT_HMAC_KEY_V1: "b".repeat(64),
  SESSION_SECRET: "c".repeat(64),
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "d".repeat(32),
  ENGINE_URL: "http://docs-engine.internal:3000",
  ENGINE_API_TOKEN: "e".repeat(32),
  AVALAI_ALLOWED_HOSTS: "api.avalai.ir",
  ASSISTANT_ALLOWED_HOSTS: "docs.example",
  ASSISTANT_ALLOWED_ORIGINS: "https://docs.example",
  TRUSTED_CLIENT_IP_HEADER: "x-liara-client-ip",
};

function validate(mode, env) {
  return spawnSync(process.execPath, [script.pathname, mode], { env, encoding: "utf8" });
}

test("deployment environment validation requires private runtime controls", () => {
  assert.equal(validate("runtime", runtimeEnv).status, 0);
  assert.equal(validate("migration", { PATH: process.env.PATH, DATABASE_URL: runtimeEnv.DATABASE_URL }).status, 0);
  for (const changed of [
    { ENGINE_API_TOKEN: "short" },
    { TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for" },
    { ENGINE_URL: "http://user:pass@docs-engine.internal" },
    { NEXT_PUBLIC_ENGINE_TOKEN: "secret" },
  ]) {
    const result = validate("runtime", { ...runtimeEnv, ...changed });
    assert.notEqual(result.status, 0);
  }
});

test("container build is secret-free and migrations are one-shot", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../Dockerfile.migrate", import.meta.url), "utf8");
  const ignored = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");
  assert.doesNotMatch(dockerfile, /\bARG\b.*(?:SECRET|TOKEN|KEY|PASSWORD)|migrate deploy/iu);
  assert.match(dockerfile, /validate-deployment-env\.mjs runtime/);
  assert.match(migration, /validate-deployment-env\.mjs migration/);
  assert.match(migration, /migrate deploy/);
  for (const entry of [".env", ".git", ".next", "node_modules"]) assert.match(ignored, new RegExp(`^${entry.replace(".", "\\.")}$`, "mu"));
  assert.equal(new URL("../Dockerfile", import.meta.url).pathname.startsWith(root.pathname), true);
});
