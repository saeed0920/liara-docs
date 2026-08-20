import { db, getConfig } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { requireAuth } from "@/lib/auth";

function mask(enc) {
  if (!enc) return null;
  try {
    return `****${decrypt(enc).slice(-4)}`;
  } catch {
    return "****";
  }
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method === "GET") {
    const cfg = await getConfig();
    return res.json({
      avalaiKeyMasked: mask(cfg.avalaiKeyEnc),
      avalaiBaseUrl: cfg.avalaiBaseUrl,
      defaultModel: cfg.defaultModel,
    });
  }

  if (req.method === "PUT") {
    const { avalaiKey, avalaiBaseUrl, defaultModel } = req.body ?? {};
    const data = {};
    if (avalaiKey) data.avalaiKeyEnc = encrypt(avalaiKey);
    if (avalaiBaseUrl) data.avalaiBaseUrl = avalaiBaseUrl;
    if (defaultModel) data.defaultModel = defaultModel;
    await db.config.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    return res.json({ ok: true });
  }

  res.status(405).end();
}
