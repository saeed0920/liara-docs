import { streamAvalai } from "@/lib/avalai.mjs";
import { getAssistantConfig } from "@/lib/assistant/config-server.mjs";
import { createDocsQueryHandler } from "@/lib/assistant/docs-query-handler.mjs";
import { retrieveDocs } from "@/lib/assistant/engine-client.mjs";
import { recordRequestMetricBestEffort } from "@/lib/assistant/observability.mjs";
import { consumeAssistantQuota } from "@/lib/assistant/rate-limit.mjs";
import { trustedClientIp } from "@/lib/assistant/request-context.mjs";
import { docsSemaphore } from "@/lib/assistant/request-state.mjs";
import { loadAssistantHmacKey } from "@/lib/assistant/runtime-secrets.mjs";
import { serverShutdownSignal } from "@/lib/assistant/server-shutdown.mjs";
import { db } from "@/lib/db";
import { estimateCost } from "@/lib/pricing";

export default createDocsQueryHandler({
  database: db,
  semaphore: docsSemaphore,
  shutdownSignal: serverShutdownSignal,
  getConfig: getAssistantConfig,
  loadHmac: loadAssistantHmacKey,
  clientIp: trustedClientIp,
  consumeQuota: consumeAssistantQuota,
  retrieveDocs,
  streamCompletion: streamAvalai,
  estimateCost,
  recordMetric: recordRequestMetricBestEffort,
});

export const config = {
  api: { bodyParser: false, responseLimit: "64kb" },
};
