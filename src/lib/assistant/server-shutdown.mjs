const controller = new AbortController();

function shutdown() {
  if (!controller.signal.aborted) controller.abort(new DOMException("Server shutting down", "AbortError"));
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

export const serverShutdownSignal = controller.signal;
export const beginServerShutdown = shutdown;
