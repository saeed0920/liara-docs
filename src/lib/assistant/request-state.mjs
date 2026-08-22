import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ConcurrencySemaphore } from "./concurrency.mjs";
import { RateLimitExceeded, RateLimitUnavailable } from "./rate-limit.mjs";

const TRANSITIONS = {
  created: ["validated"],
  validated: ["admitting"],
  admitting: ["admitted"],
  admitted: ["retrieving"],
  retrieving: ["starting_provider", "streaming"],
  starting_provider: ["streaming"],
  streaming: ["terminal"],
  terminal: [],
};
export const docsSemaphore = new ConcurrencySemaphore(4);

export class RequestFailure extends Error {
  constructor(status, code, retryAfter) {
    super(code);
    this.name = "RequestFailure";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function createRequestState({ timeoutMs = 45_000, clock = () => performance.now(), signals = [] } = {}) {
  const startedAt = clock();
  const deadlineMs = startedAt + Math.min(timeoutMs, 45_000);
  const controller = new AbortController();
  let stage = "created";
  let release;
  const linkedSignals = signals.map((signal) => {
    const abort = () => controller.abort(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    return { signal, abort };
  });
  const timer = setTimeout(() => controller.abort(new DOMException("Deadline exceeded", "TimeoutError")), Math.max(0, deadlineMs - clock()));
  return {
    requestId: randomUUID(),
    startedAt,
    deadlineMs,
    signal: controller.signal,
    get stage() { return stage; },
    enter(next) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (clock() >= deadlineMs) {
        controller.abort(new DOMException("Deadline exceeded", "TimeoutError"));
        throw controller.signal.reason;
      }
      if (!TRANSITIONS[stage]?.includes(next)) throw new RequestFailure(502, "invalid_state");
      stage = next;
    },
    remainingMs() { return Math.max(0, deadlineMs - clock()); },
    cap(ms) { return Math.min(deadlineMs, clock() + ms); },
    hold(value) { release = value; },
    abort(reason = new DOMException("Aborted", "AbortError")) { controller.abort(reason); },
    finish() {
      release?.();
      release = undefined;
      clearTimeout(timer);
      for (const linked of linkedSignals) linked.signal.removeEventListener("abort", linked.abort);
      stage = "terminal";
    },
  };
}

export function linkRequestAbort(state, req, res) {
  const abort = () => {
    state.abort(new DOMException("Disconnected", "AbortError"));
  };
  const close = () => {
    if (!res.writableEnded) abort();
  };
  if (req.aborted) abort();
  else req.once("aborted", abort);
  res.once("close", close);
  return () => {
    req.removeListener("aborted", abort);
    res.removeListener("close", close);
  };
}

export async function admitDocsQuery({
  state,
  req,
  request,
  dependencies,
}) {
  state.enter("admitting");
  let config;
  let hmac;
  let ip;
  try {
    config = await dependencies.getConfig();
    if (!config.assistantEnabled) throw new RequestFailure(503, "assistant_disabled");
    hmac = dependencies.loadHmac();
    ip = dependencies.clientIp(req.headers);
    await dependencies.consumeQuota({
      db: dependencies.database,
      ip,
      sessionId: request.sessionId,
      secret: hmac.key,
      keyVersion: hmac.version,
      minuteLimit: config.assistantMinuteLimit,
      dayLimit: config.assistantDayLimit,
      deadlineMs: state.cap(1_000),
    });
  } catch (error) {
    if (error instanceof RequestFailure) throw error;
    if (error instanceof RateLimitExceeded) throw new RequestFailure(429, "rate_limited", error.retryAfter);
    if (error instanceof RateLimitUnavailable) throw new RequestFailure(503, "rate_limit_unavailable");
    throw new RequestFailure(503, "configuration_unavailable");
  }
  dependencies.semaphore.setLimit(config.assistantConcurrencyLimit);
  const release = dependencies.semaphore.acquire();
  if (!release) throw new RequestFailure(429, "concurrency_limited", 1);
  state.hold(release);
  state.enter("admitted");
  return { config, hmac, ip };
}
