import { db, getConfig } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { allow } from "@/lib/rate";
import { estimateCost } from "@/lib/pricing";

async function record(m) {
  const prompt = m.usage?.prompt_tokens ?? null;
  const completion = m.usage?.completion_tokens ?? null;
  await db.requestMetric.create({
    data: {
      clientUuid: m.clientUuid,
      model: m.model,
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: m.usage?.total_tokens ?? null,
      costEstimate: estimateCost(m.model, prompt, completion),
      latencyMs: m.latencyMs,
      status: m.status,
      errorType: m.errorType ?? null,
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const body = req.body ?? {};
  const clientUuid = body.clientUuid;
  if (!clientUuid) return res.status(400).json({ error: "clientUuid required" });

  if (!allow(clientUuid)) {
    await record({
      clientUuid,
      model: body.model ?? null,
      latencyMs: 0,
      status: "rate_limited",
    });
    return res.status(429).json({ error: "rate limit exceeded" });
  }

  const cfg = await getConfig();
  if (!cfg.avalaiKeyEnc)
    return res.status(503).json({ error: "AvalAI key not configured" });

  const { clientUuid: _drop, ...payload } = body;
  const stream = payload.stream === true;
  if (stream) payload.stream_options = { include_usage: true };

  const start = Date.now();
  let upstream;
  try {
    upstream = await fetch(`${cfg.avalaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${decrypt(cfg.avalaiKeyEnc)}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    await record({
      clientUuid,
      model: payload.model ?? null,
      latencyMs: Date.now() - start,
      status: "error",
      errorType: "upstream_fetch_failed",
    });
    return res.status(502).json({ error: "upstream unreachable" });
  }

  if (!upstream.ok || !upstream.body) {
    await record({
      clientUuid,
      model: payload.model ?? null,
      latencyMs: Date.now() - start,
      status: "error",
      errorType: `upstream_${upstream.status}`,
    });
    const text = await upstream.text().catch(() => "");
    return res
      .status(upstream.status)
      .json({ error: "upstream error", detail: text.slice(0, 500) });
  }

  if (!stream) {
    const json = await upstream.json();
    await record({
      clientUuid,
      model: json.model ?? payload.model ?? null,
      usage: json.usage ?? null,
      latencyMs: Date.now() - start,
      status: "ok",
    });
    return res.json(json);
  }

  // Stream passthrough; sniff usage/model from SSE chunks as they flow.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let usage = null;
  let model = payload.model ?? null;
  let buf = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          if (j.usage) usage = j.usage;
          if (j.model) model = j.model;
        } catch {
          /* partial/non-JSON chunk, ignore */
        }
      }
    }
  } catch {
    /* client disconnect or upstream break; record what we have */
  } finally {
    res.end();
    await record({
      clientUuid,
      model,
      usage,
      latencyMs: Date.now() - start,
      status: "ok",
    });
  }
}

export const config = {
  api: { responseLimit: false },
};
