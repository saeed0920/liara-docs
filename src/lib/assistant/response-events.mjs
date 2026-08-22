export const INSUFFICIENT_CONTEXT_MESSAGE = "منبع کافی پیدا نشد";

export function insufficientContextEvents({ requestId, model }) {
  return [
    { type: "meta", data: { requestId, model } },
    { type: "sources", data: [] },
    { type: "delta", data: { text: INSUFFICIENT_CONTEXT_MESSAGE } },
    { type: "done", data: { finishReason: "stop", usage: null } },
  ];
}

export async function resolveRetrieval({ retrieval, requestId, model, startCompletion }) {
  if (retrieval.insufficientContext || !retrieval.sources.length) {
    return { events: insufficientContextEvents({ requestId, model }), completion: null };
  }
  return { events: null, completion: await startCompletion() };
}

export async function* assistantCompletionEvents({
  requestId,
  model,
  sources,
  providerEvents,
  onSummary = () => {},
}) {
  yield { type: "meta", data: { requestId, model } };
  yield {
    type: "sources",
    data: sources.map(({ id, title, url, anchor, snippet }) => ({ id, title, url, anchor, snippet })),
  };
  let usage = null;
  let finishReason = "stop";
  let answer = "";
  for await (const event of providerEvents) {
    if (event.type === "delta") {
      answer += event.text;
      yield { type: "delta", data: { text: event.text } };
    }
    if (event.type === "usage") usage = event.usage;
    if (event.finishReason === "length") finishReason = "length";
  }
  // ponytail: reasoning models can spend the whole token budget on hidden chain-of-thought and emit
  // no visible delta, so `done` would otherwise land as a silent blank bubble. Fail loud, let UI retry.
  if (!answer.trim()) throw new Error("assistant produced no visible content");
  const sourceIds = new Set(sources.map(({ id }) => id));
  const citations = [...answer.matchAll(/\[(S\d+)\]/gu)].map((match) => match[1]);
  const citationValid = citations.length > 0 && citations.every((id) => sourceIds.has(id));
  onSummary({ finishReason, usage, citationValid });
  yield { type: "done", data: { finishReason, usage } };
}

export function startAssistantStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

export function writeAssistantEvent(res, event, { signal } = {}) {
  if (signal?.aborted) throw signal.reason;
  if (res.writableEnded || res.destroyed) throw new DOMException("Disconnected", "AbortError");
  return res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}
