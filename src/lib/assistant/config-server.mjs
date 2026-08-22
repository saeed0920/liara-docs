import { getConfig } from "../db.js";
import { createAssistantConfigCache } from "./config-cache.mjs";

export const assistantConfigCache = createAssistantConfigCache({ load: getConfig, ttlMs: 30_000 });

export const getAssistantConfig = assistantConfigCache.get;
export const invalidateAssistantConfig = assistantConfigCache.invalidate;
