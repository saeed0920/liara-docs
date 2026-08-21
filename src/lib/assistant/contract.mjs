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

export const initialAssistantState = {
  hydrated: false,
  phase: "idle",
  messages: [],
  error: null,
  suggestions: [],
  suggestionPrompt: "ادامه گفتگو",
};

export function validSource(source) {
  if (!source?.id || !source?.title || !source?.url) return false;
  return source.url.startsWith("/") && !source.url.startsWith("//");
}

export function validateEvent(event) {
  if (!event || !["meta", "sources", "delta", "suggestions", "done", "error"].includes(event.type)) {
    throw new Error("assistant event invalid");
  }
  if (event.type === "sources" && !event.sources?.every(validSource)) {
    throw new Error("assistant source invalid");
  }
  if (event.type === "delta" && typeof event.text !== "string") {
    throw new Error("assistant delta invalid");
  }
  if (event.type === "suggestions" && !event.suggestions?.every((item) => typeof item === "string")) {
    throw new Error("assistant suggestions invalid");
  }
  if (event.type === "error" && typeof event.message !== "string") {
    throw new Error("assistant error invalid");
  }
  return event;
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
      const messages = [...state.messages];
      const last = { ...messages.at(-1) };
      if (event.type === "sources") last.sources = event.sources;
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
