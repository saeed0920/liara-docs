import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentEncryptionVersion, encrypt } from "@/lib/crypto.mjs";
import { validateAssistantConfigUpdate } from "@/lib/assistant/admin-config.mjs";
import { getAssistantConfig, invalidateAssistantConfig } from "@/lib/assistant/config-server.mjs";
import { auditIdentity, recordAssistantAudit } from "@/lib/assistant/observability.mjs";

export default async function handler(req, res) {
  const administratorId = getSession(req);
  if (!administratorId) return res.status(401).json({ error: "unauthorized" });

  if (req.method === "GET") {
    try {
      const config = await getAssistantConfig();
      return res.json({
        avalaiKeyConfigured: Boolean(config.avalaiKeyEnc),
        avalaiKeyMasked: config.avalaiKeyEnc ? "••••••••" : null,
        avalaiBaseUrl: config.avalaiBaseUrl,
        defaultModel: config.defaultModel,
        assistantEnabled: config.assistantEnabled,
        assistantMinuteLimit: config.assistantMinuteLimit,
        assistantDayLimit: config.assistantDayLimit,
      });
    } catch {
      return res.status(500).json({ error: "configuration unavailable" });
    }
  }

  if (req.method === "PUT") {
    let identity;
    let current;
    try {
      identity = auditIdentity(req);
      current = await getAssistantConfig();
    } catch {
      return res.status(503).json({ error: "configuration unavailable" });
    }
    let value;
    try {
      value = validateAssistantConfigUpdate(req.body);
    } catch {
      await recordAssistantAudit({
        db,
        eventType: "config_save",
        administratorId,
        success: false,
        identity,
        retentionDays: current.auditRetentionDays,
        metadata: { outcomeCode: "invalid_configuration" },
      }).catch(() => {});
      return res.status(400).json({ error: "invalid configuration" });
    }
    const data = {
      avalaiBaseUrl: value.baseUrl,
      defaultModel: value.model,
      assistantEnabled: value.assistantEnabled,
      assistantMinuteLimit: value.assistantMinuteLimit,
      assistantDayLimit: value.assistantDayLimit,
    };
    if (value.avalaiKey) {
      data.avalaiKeyEnc = encrypt(value.avalaiKey);
      data.avalaiKeyVersion = currentEncryptionVersion();
    }
    try {
      await db.$transaction(async (tx) => {
        await tx.config.upsert({
          where: { id: 1 },
          create: { id: 1, ...data },
          update: data,
        });
        await recordAssistantAudit({
          db: tx,
          eventType: "config_save",
          administratorId,
          success: true,
          identity,
          retentionDays: current.auditRetentionDays,
          metadata: {
            changedFields: Object.keys(req.body),
            model: value.model,
            providerHost: new URL(value.baseUrl).hostname,
            assistantEnabled: value.assistantEnabled,
            outcomeCode: "saved",
          },
        });
      });
      invalidateAssistantConfig();
      return res.json({ ok: true });
    } catch {
      await recordAssistantAudit({
        db,
        eventType: "config_save",
        administratorId,
        success: false,
        identity,
        retentionDays: current.auditRetentionDays,
        metadata: { outcomeCode: "save_failed" },
      }).catch(() => {});
      return res.status(500).json({ error: "configuration save failed" });
    }
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).end();
}

export const config = {
  api: { bodyParser: { sizeLimit: "8kb" } },
};
