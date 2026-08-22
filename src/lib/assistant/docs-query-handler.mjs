import { performance } from "node:perf_hooks";
import { PayloadTooLarge, readJsonBody, validateDocsQuery, validateRequestEnvelope } from "./docs-query-request.mjs";
import { publicFailure, terminalFailure } from "./failures.mjs";
import { recordRequestMetricBestEffort, terminalStatus } from "./observability.mjs";
import { buildPromptV1 } from "./prompt.mjs";
import { hmacSubject } from "./rate-limit.mjs";
import { admitDocsQuery, createRequestState, linkRequestAbort } from "./request-state.mjs";
import { assistantCompletionEvents, resolveRetrieval, startAssistantStream, writeAssistantEvent } from "./response-events.mjs";

export function createDocsQueryHandler(dependencies) {
  const {
    database,
    semaphore,
    shutdownSignal,
    getConfig,
    loadHmac,
    clientIp,
    consumeQuota,
    retrieveDocs,
    streamCompletion,
    estimateCost = () => null,
    recordMetric = recordRequestMetricBestEffort,
  } = dependencies;

  return async function docsQueryHandler(req, res) {
    const state = createRequestState({ signals: shutdownSignal ? [shutdownSignal] : [] });
    const unlink = linkRequestAbort(state, req, res);
    let contractValidated = false;
    let terminalSent = false;
    let admitted;
    let request;
    let metricEligible = false;
    let metricStatus = "error";
    let metricErrorType;
    let configRateLatencyMs;
    let retrievalLatencyMs;
    let firstByteLatencyMs;
    let sourceCount = 0;
    let abstention = false;
    let providerRequestId;
    let usage;
    let groundedSuccess = false;

    if (req.method !== "POST") {
      unlink();
      state.finish();
      res.setHeader("Allow", "POST");
      return res.status(405).json({ code: "INVALID_METHOD", requestId: state.requestId });
    }
    try {
      validateRequestEnvelope(req);
    } catch {
      unlink();
      state.finish();
      return res.status(400).json({ code: "INVALID_REQUEST", requestId: state.requestId });
    }

    try {
      request = validateDocsQuery(await readJsonBody(req));
      state.enter("validated");
      contractValidated = true;
      metricEligible = true;
      admitted = await admitDocsQuery({
        state,
        req,
        request,
        dependencies: { getConfig, loadHmac, clientIp, consumeQuota, database, semaphore },
      });
      state.enter("retrieving");
      const retrievalStarted = performance.now();
      configRateLatencyMs = Math.round(retrievalStarted - state.startedAt);
      const retrieval = await retrieveDocs({
        message: request.message,
        pagePath: request.page.path,
        signal: state.signal,
        deadlineMs: state.cap(8_000),
      });
      retrievalLatencyMs = Math.round(performance.now() - retrievalStarted);
      sourceCount = retrieval.sources.length;
      abstention = retrieval.insufficientContext || sourceCount === 0;
      const outcome = await resolveRetrieval({
        retrieval,
        requestId: state.requestId,
        model: admitted.config.defaultModel,
        startCompletion: async () => {
          state.enter("starting_provider");
          const prompt = buildPromptV1({ request, retrieval });
          const iterator = streamCompletion({
            config: admitted.config,
            messages: prompt.messages,
            maxTokens: 800,
            signal: state.signal,
            firstByteTimeoutMs: 10_000,
            totalDeadlineMs: state.deadlineMs,
          })[Symbol.asyncIterator]();
          const first = await iterator.next();
          if (first.done) throw new Error("provider stream ended before first event");
          firstByteLatencyMs = Math.round(performance.now() - state.startedAt);
          providerRequestId = first.value?.metadata?.requestId;
          return { first: first.value, iterator };
        },
      });
      if (outcome.events) {
        state.enter("streaming");
        startAssistantStream(res);
        for (const event of outcome.events) {
          writeAssistantEvent(res, event, { signal: state.signal });
          if (event.type === "done") terminalSent = true;
        }
        res.end();
        metricStatus = "ok";
        return;
      }
      const providerEvents = (async function* () {
        yield outcome.completion.first;
        for (;;) {
          const item = await outcome.completion.iterator.next();
          if (item.done) return;
          yield item.value;
        }
      })();
      state.enter("streaming");
      startAssistantStream(res);
      for await (const event of assistantCompletionEvents({
        requestId: state.requestId,
        model: admitted.config.defaultModel,
        sources: retrieval.sources,
        providerEvents,
        onSummary: (summary) => {
          usage = summary.usage;
          groundedSuccess = summary.citationValid;
        },
      })) {
        writeAssistantEvent(res, event, { signal: state.signal });
        if (event.type === "done") terminalSent = true;
      }
      res.end();
      metricStatus = "ok";
    } catch (error) {
      metricStatus = terminalStatus(error);
      if (error instanceof PayloadTooLarge) return res.status(413).json({ code: "REQUEST_TOO_LARGE", requestId: state.requestId });
      if (!contractValidated) return res.status(400).json({ code: "INVALID_REQUEST", requestId: state.requestId });
      const failure = publicFailure(error);
      metricErrorType = failure.code;
      if (res.headersSent) {
        if (!terminalSent && !res.writableEnded && !res.destroyed) {
          writeAssistantEvent(res, terminalFailure(error, state.requestId));
          terminalSent = true;
        }
        if (!res.writableEnded) res.end();
        return;
      }
      if (failure.retryAfter) res.setHeader("Retry-After", String(failure.retryAfter));
      return res.status(failure.status).json({ code: failure.code, requestId: state.requestId });
    } finally {
      unlink();
      state.finish();
      if (metricEligible) {
        await recordMetric({
          db: database,
          metric: {
            requestId: state.requestId,
            providerRequestId,
            requestType: "docs_assistant",
            model: admitted?.config.defaultModel,
            status: metricStatus,
            errorType: metricErrorType,
            subjectIpHmac: admitted ? hmacSubject(admitted.hmac.key, "ip", admitted.ip) : undefined,
            subjectSessionHmac: admitted ? hmacSubject(admitted.hmac.key, "session", request.sessionId) : undefined,
            identifierKeyVersion: admitted?.hmac.version,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            estimatedCost: estimateCost(admitted?.config.defaultModel, usage?.inputTokens, usage?.outputTokens),
            configRateLatencyMs,
            retrievalLatencyMs,
            firstByteLatencyMs,
            totalLatencyMs: Math.round(performance.now() - state.startedAt),
            sourceCount,
            abstention,
            groundedSuccess,
          },
        });
      }
    }
  };
}
