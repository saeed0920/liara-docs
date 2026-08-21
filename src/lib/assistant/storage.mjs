export const STORAGE_KEY = "liara-docs-assistant:v1";
export const PREFERENCE_KEY = "liara-docs-assistant:preference";
const MODES = ["normal", "tutorial", "command"];
const MAX_MESSAGES = 10;
const MAX_SIZE = 100_000;

export function loadThread(storage = globalThis.sessionStorage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    if (saved?.version !== 1 || !Array.isArray(saved.messages)) return [];
    return saved.messages.filter(
      (message) =>
        ["user", "assistant"].includes(message?.role) &&
        typeof message.content === "string",
    );
  } catch {
    return [];
  }
}

export function saveThread(messages, storage = globalThis.sessionStorage) {
  const kept = messages.slice(-MAX_MESSAGES);
  let value = JSON.stringify({ version: 1, messages: kept });
  while (value.length > MAX_SIZE && kept.length > 1) {
    kept.shift();
    value = JSON.stringify({ version: 1, messages: kept });
  }
  storage.setItem(STORAGE_KEY, value);
  return kept;
}

export function clearThread(storage = globalThis.sessionStorage) {
  storage.removeItem(STORAGE_KEY);
}

export function loadPreference(storage = globalThis.localStorage) {
  const mode = storage.getItem(PREFERENCE_KEY);
  return MODES.includes(mode) ? mode : "normal";
}

export function savePreference(mode, storage = globalThis.localStorage) {
  storage.setItem(PREFERENCE_KEY, MODES.includes(mode) ? mode : "normal");
}
