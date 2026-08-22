import { AvalaiProviderError, AvalaiStreamError } from "../avalai.mjs";
import { EngineClientError } from "./engine-client.mjs";
import { RequestFailure } from "./request-state.mjs";

const REQUEST_CODES = {
  assistant_disabled: "ASSISTANT_DISABLED",
  rate_limited: "RATE_LIMITED",
  concurrency_limited: "RATE_LIMITED",
  rate_limit_unavailable: "DEPENDENCY_UNAVAILABLE",
  configuration_unavailable: "DEPENDENCY_UNAVAILABLE",
  timeout: "TIMEOUT",
};

export function terminalFailure(error, requestId) {
  const failure = publicFailure(error);
  return {
    type: "error",
    data: {
      code: error?.name === "AbortError" ? "CANCELLED" : error?.name === "TimeoutError" ? "TIMEOUT" : "UPSTREAM_STREAM_FAILED",
      requestId,
      retryable: failure.retryable,
    },
  };
}

export function publicFailure(error) {
  if (error instanceof RequestFailure) return {
    status: error.status,
    code: REQUEST_CODES[error.code] ?? "DEPENDENCY_UNAVAILABLE",
    retryable: error.status >= 429,
    retryAfter: error.retryAfter,
  };
  if (error instanceof EngineClientError) {
    const timeout = error.code === "engine_timeout";
    return { status: timeout ? 504 : 502, code: timeout ? "TIMEOUT" : "RETRIEVAL_FAILED", retryable: true };
  }
  if (error instanceof AvalaiProviderError) return { status: 502, code: "PROVIDER_UNAVAILABLE", retryable: error.status === 429 || error.status >= 500 };
  if (error instanceof AvalaiStreamError) return { status: 502, code: "UPSTREAM_STREAM_FAILED", retryable: false };
  if (typeof error?.message === "string" && /AvalAI (model|base URL|key)/.test(error.message)) {
    return { status: 503, code: "DEPENDENCY_UNAVAILABLE", retryable: true };
  }
  if (error?.name === "TimeoutError") return { status: 504, code: "TIMEOUT", retryable: true };
  if (error?.name === "AbortError") return { status: 504, code: "CANCELLED", retryable: true };
  return { status: 502, code: "UPSTREAM_FAILED", retryable: true };
}
