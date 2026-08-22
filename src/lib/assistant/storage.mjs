export const STORAGE_KEY = "liara-docs-assistant:v1";
export const PREFERENCE_KEY = "liara-docs-assistant:preference:v1";
const MODES = ["normal", "tutorial", "command"];
const MAX_MESSAGES = 10;
const MAX_SIZE = 100_000;
const bytes = (value) => new TextEncoder().encode(value).byteLength;

function reset(storage) {
  try { storage.removeItem(STORAGE_KEY); } catch { /* unavailable storage */ }
  return [];
}

export function loadThread(storage = globalThis.sessionStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw || bytes(raw) > MAX_SIZE) return reset(storage);
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.messages) || saved.messages.length > MAX_MESSAGES) return reset(storage);
    const messages = saved.messages.filter(
      (message) =>
        ["user", "assistant"].includes(message?.role) &&
        typeof message.content === "string",
    );
    return messages.length === saved.messages.length ? messages : reset(storage);
  } catch {
    return reset(storage);
  }
}

export function saveThread(messages, storage = globalThis.sessionStorage) {
  const kept = messages.slice(-MAX_MESSAGES);
  let value = JSON.stringify({ version: 1, messages: kept });
  while (bytes(value) > MAX_SIZE && kept.length) {
    kept.shift();
    value = JSON.stringify({ version: 1, messages: kept });
  }
  try { storage.setItem(STORAGE_KEY, value); } catch { return []; }
  return kept;
}

export function clearThread(storage = globalThis.sessionStorage) {
  storage.removeItem(STORAGE_KEY);
}

export function loadPreference(storage = globalThis.sessionStorage) {
  const mode = storage.getItem(PREFERENCE_KEY);
  return MODES.includes(mode) ? mode : "normal";
}

export function savePreference(mode, storage = globalThis.sessionStorage) {
  storage.setItem(PREFERENCE_KEY, MODES.includes(mode) ? mode : "normal");
}
