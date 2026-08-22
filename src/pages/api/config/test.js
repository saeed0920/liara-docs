import { performance } from "node:perf_hooks";
import { getSession } from "@/lib/auth";
import { encrypt } from "@/lib/crypto.mjs";
import { streamAvalai } from "@/lib/avalai.mjs";
import { validateProviderCandidate } from "@/lib/assistant/admin-config.mjs";
import { getAssistantConfig } from "@/lib/assistant/config-server.mjs";
import {
  ConnectionTestLimitExceeded,
  createConnectionTestLimiter,
} from "@/lib/assistant/connection-test-limit.mjs";
import { auditIdentity, recordAssistantAudit } from "@/lib/assistant/observability.mjs";
import { hmacSubject } from "@/lib/assistant/rate-limit.mjs";
import { loadAssistantHmacKey } from "@/lib/assistant/runtime-secrets.mjs";
import { db } from "@/lib/db";

const limiter = createConnectionTestLimiter();

export default async function handler(req, res) {
  const administratorId = getSession(req);
  if (!administratorId) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  let current;
  let identity;
  try {
    current = await getAssistantConfig();
    identity = auditIdentity(req);
  } catch {
    return res.status(503).json({ error: "connection test unavailable" });
  }
  const respond = async (status, body, success, outcomeCode, headers = {}) => {
    try {
      await recordAssistantAudit({
        db,
        eventType: "connection_test",
        administratorId,
        success,
        identity,
        retentionDays: current.auditRetentionDays,
        metadata: { outcomeCode },
      });
    } catch {
      return res.status(500).json({ error: "connection test audit failed" });
    }
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    return res.status(status).json(body);
  };

  let candidate;
  try {
    candidate = validateProviderCandidate(req.body);
  } catch {
    return respond(400, { error: "invalid provider configuration" }, false, "invalid_configuration");
  }

  try {
    const hmac = loadAssistantHmacKey();
    limiter.consume(hmacSubject(hmac.key, "connection_test", administratorId));
  } catch (error) {
    if (error instanceof ConnectionTestLimitExceeded) {
      return respond(429, { error: "connection test rate limited" }, false, "rate_limited", { "Retry-After": String(error.retryAfter) });
    }
    return respond(503, { error: "connection test unavailable" }, false, "quota_unavailable");
  }

  const avalaiKeyEnc = candidate.avalaiKey ? encrypt(candidate.avalaiKey) : current.avalaiKeyEnc;
  if (!avalaiKeyEnc) return respond(400, { error: "AvalAI key is required" }, false, "key_missing");

  try {
    for await (const _event of streamAvalai({
      config: {
        avalaiKeyEnc,
        avalaiBaseUrl: candidate.baseUrl,
        defaultModel: candidate.model,
      },
      messages: [{ role: "user", content: "Reply with OK." }],
      maxTokens: 16,
      maxRetries: 0,
      totalDeadlineMs: performance.now() + 8_000,
      firstByteTimeoutMs: 5_000,
    })) {
      // Validate and drain the short response without retaining its content.
    }
    return respond(200, { ok: true }, true, "ok");
  } catch (error) {
    if (error?.name === "TimeoutError") return respond(504, { error: "connection test timed out" }, false, "timeout");
    return respond(502, { error: "connection test failed" }, false, "provider_error");
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "4kb" } },
};
