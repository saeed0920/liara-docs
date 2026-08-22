export const SCENARIOS = [
  "success",
  "slow",
  "empty",
  "rate-limit",
  "provider-error",
  "broken-stream",
  "rich-content",
  "long-thread",
];
export const ASSISTANT_MODES = ["normal", "tutorial", "command"];
export const FINISH_REASONS = ["stop", "length", "cancelled", "error"];
export const SOURCE_IDS = ["S1", "S2", "S3", "S4", "S5"];
export const EVENT_TYPES = ["meta", "sources", "delta", "suggestions", "done", "error"];
export const ERROR_MESSAGES = {
  ASSISTANT_DISABLED: "دستیار در حال حاضر غیرفعال است.",
  DEPENDENCY_UNAVAILABLE: "سرویس دستیار موقتاً در دسترس نیست.",
  INVALID_REQUEST: "درخواست معتبر نیست. دوباره تلاش کنید.",
  REQUEST_TOO_LARGE: "حجم درخواست بیش از حد مجاز است.",
  RATE_LIMITED: "تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.",
  RETRIEVAL_FAILED: "جست‌وجو در مستندات انجام نشد. دوباره تلاش کنید.",
  PROVIDER_UNAVAILABLE: "سرویس پاسخ‌گو نیست. دوباره تلاش کنید.",
  TIMEOUT: "مهلت دریافت پاسخ تمام شد. دوباره تلاش کنید.",
  UPSTREAM_STREAM_FAILED: "ارتباط هنگام دریافت پاسخ قطع شد.",
  UPSTREAM_FAILED: "سرویس پاسخ‌گو نیست. دوباره تلاش کنید.",
};

/** @typedef {"normal" | "tutorial" | "command"} AssistantMode */
/** @typedef {{role: "user" | "assistant", content: string}} AssistantHistoryMessage */
/** @typedef {{path: string, title: string}} AssistantPage */
/** @typedef {{sessionId: string, mode: AssistantMode, message: string, history: AssistantHistoryMessage[], page: AssistantPage}} DocsQueryRequest */
/** @typedef {{id: "S1" | "S2" | "S3" | "S4" | "S5", title: string, url: string, anchor: string, snippet: string}} AssistantSource */
/** @typedef {{type: "meta", requestId: string, model: string} | {type: "sources", sources: AssistantSource[]} | {type: "delta", text: string} | {type: "suggestions", suggestions: string[]} | {type: "done", finishReason: "stop" | "length" | "cancelled" | "error", usage: object | null} | {type: "error", code: string, requestId: string, retryable: boolean}} AssistantTransportEvent */

export const initialAssistantState = {
  hydrated: false,
  phase: "idle",
  messages: [],
  error: null,
  suggestions: [],
  suggestionPrompt: "ادامه گفتگو",
};

export function validSource(source) {
  const internalUrl = typeof source?.url === "string"
    && /^\/[a-z0-9/_-]*$/i.test(source.url)
    && !source.url.startsWith("//")
    && !source.url.split("/").includes("..");
  const anchor = typeof source?.anchor === "string" && !/[#?/\\\s]/u.test(source.anchor);
  return SOURCE_IDS.includes(source?.id)
    && typeof source.title === "string" && source.title.length > 0
    && internalUrl && anchor
    && typeof source.snippet === "string";
}

export function dedupeSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    if (!validSource(source)) return false;
    const target = `${source.url}#${source.anchor}`;
    if (seen.has(source.id) || seen.has(target)) return false;
    seen.add(source.id);
    seen.add(target);
    return true;
  });
}

export function sourceForCitation(id, sources) {
  return SOURCE_IDS.includes(id) ? dedupeSources(sources).find((source) => source.id === id) ?? null : null;
}

export function safeAssistantHref(href) {
  if (typeof href !== "string" || /[\u0000-\u001f\\]/u.test(href)) return "";
  if (href.startsWith("/") && !href.startsWith("//")) {
    try {
      const path = decodeURIComponent(href.split(/[?#]/u, 1)[0]);
      return path.split("/").includes("..") ? "" : href;
    } catch {
      return "";
    }
  }
  try {
    return new URL(href).protocol === "https:" ? href : "";
  } catch {
    return "";
  }
}

/** @param {AssistantTransportEvent} event @returns {AssistantTransportEvent} */
export function validateEvent(event) {
  if (!event || !EVENT_TYPES.includes(event.type)) throw new Error("assistant event invalid");
  if (event.type === "meta" && (!event.requestId || !event.model)) throw new Error("assistant meta invalid");
  if (event.type === "sources" && (!Array.isArray(event.sources) || event.sources.length > 5 || !event.sources.every(validSource))) throw new Error("assistant source invalid");
  if (event.type === "delta" && typeof event.text !== "string") throw new Error("assistant delta invalid");
  if (event.type === "suggestions" && (!Array.isArray(event.suggestions) || !event.suggestions.every((item) => typeof item === "string"))) throw new Error("assistant suggestions invalid");
  if (event.type === "done" && (!FINISH_REASONS.includes(event.finishReason) || !(event.usage === null || typeof event.usage === "object"))) throw new Error("assistant done invalid");
  if (event.type === "error" && (!event.code || !event.requestId || typeof event.retryable !== "boolean")) throw new Error("assistant error invalid");
  return event;
}

export function createEventSequenceValidator() {
  let phase = "start";
  return {
    push(event) {
      validateEvent(event);
      if (phase === "terminal") throw new Error("assistant event after terminal");
      if (event.type === "error") {
        if (phase === "start") throw new Error("assistant meta required");
        phase = "terminal";
        return event;
      }
      if (phase === "start" && event.type !== "meta") throw new Error("assistant meta required");
      if (phase === "meta" && event.type !== "sources") throw new Error("assistant sources required");
      if (phase === "sources" && !["delta", "suggestions", "done"].includes(event.type)) throw new Error("assistant event order invalid");
      if (phase === "delta" && !["delta", "suggestions", "done"].includes(event.type)) throw new Error("assistant event order invalid");
      if (phase === "suggestions" && event.type !== "done") throw new Error("assistant done required");
      if (event.type === "meta") phase = "meta";
      else if (event.type === "sources") phase = "sources";
      else if (event.type === "delta") phase = "delta";
      else if (event.type === "suggestions") phase = "suggestions";
      else if (event.type === "done") phase = "terminal";
      return event;
    },
    end() {
      if (phase !== "terminal") throw new Error("assistant stream ended without terminal event");
    },
  };
}

export function assistantReducer(state, action) {
  switch (action.type) {
    case "hydrate":
      return { ...initialAssistantState, hydrated: true, messages: action.messages };
    case "submit":
      return {
        ...state,
        phase: "submitting",
        error: null,
        suggestions: [],
        suggestionPrompt: initialAssistantState.suggestionPrompt,
        messages: [
          ...state.messages,
          action.user,
          { ...action.assistant, content: "", sources: [], status: "streaming" },
        ],
      };
    case "retry":
      return {
        ...state,
        phase: "submitting",
        error: null,
        suggestions: [],
        suggestionPrompt: initialAssistantState.suggestionPrompt,
        messages: [
          ...state.messages.slice(0, -1),
          { ...action.assistant, content: "", sources: [], status: "streaming" },
        ],
      };
    case "event": {
      const event = validateEvent(action.event);
      if (event.type === "error") return assistantReducer(state, {
        type: "error",
        error: { ...event, message: ERROR_MESSAGES[event.code] ?? "پاسخ کامل نشد. دوباره تلاش کنید." },
      });
      const messages = [...state.messages];
      const last = { ...messages.at(-1) };
      if (event.type === "sources") last.sources = dedupeSources(event.sources);
      if (event.type === "delta") last.content += event.text;
      if (event.type === "done") last.status = "done";
      messages[messages.length - 1] = last;
      return {
        ...state,
        messages,
        phase: event.type === "done" ? "done" : event.type === "delta" ? "streaming" : state.phase,
        suggestions: event.type === "suggestions" ? event.suggestions : state.suggestions,
        suggestionPrompt: event.type === "suggestions" ? event.prompt || initialAssistantState.suggestionPrompt : state.suggestionPrompt,
      };
    }
    case "error": {
      const messages = [...state.messages];
      const last = { ...messages.at(-1), status: "error" };
      messages[messages.length - 1] = last;
      return { ...state, messages, phase: "error", error: action.error };
    }
    case "stop": {
      const messages = [...state.messages];
      const last = { ...messages.at(-1), status: "stopped" };
      messages[messages.length - 1] = last;
      return { ...state, messages, phase: "stopped" };
    }
    case "clear":
      return { ...initialAssistantState, hydrated: true };
    default:
      return state;
  }
}
