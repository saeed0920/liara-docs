import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { realTransport } from "../src/lib/assistant/transport.mjs";

const NO_SOURCE_TEXT = "منبع کافی پیدا نشد";

export function citationStats(text, sourceIds) {
  const cited = [...text.matchAll(/\[(S[1-5])\]/g)].map(([, id]) => id);
  const valid = cited.filter((id) => sourceIds.includes(id));
  const unknown = cited.filter((id) => !sourceIds.includes(id));
  return { cited: cited.length, valid: valid.length, unknown: unknown.length };
}

export function abstentionOk(text, sources) {
  return text.trim() === NO_SOURCE_TEXT && sources.length === 0;
}

async function runCase(item, { assistantUrl, fetchImpl }) {
  const request = {
    sessionId: randomUUID(),
    mode: "normal",
    message: item.question,
    history: [],
    page: { path: item.pagePath, title: "" },
  };
  const sources = [];
  const suggestions = [];
  let text = "";
  let finishReason = null;
  let errorCode = null;
  try {
    for await (const event of realTransport(request, {
      fetchImpl: (path, init) => fetchImpl(new URL(path, assistantUrl), {
        ...init,
        headers: { ...init.headers, origin: assistantUrl, "x-liara-client-ip": "127.0.0.1" },
      }),
    })) {
      if (event.type === "sources") sources.push(...event.sources);
      else if (event.type === "delta") text += event.text ?? "";
      else if (event.type === "suggestions") suggestions.push(...event.suggestions);
      else if (event.type === "done") finishReason = event.finishReason;
      else if (event.type === "error") errorCode = event.code;
    }
  } catch (error) {
    errorCode = error?.message ?? "transport_failed";
  }
  const ids = sources.map((source) => source.id);
  const stats = citationStats(text, ids);
  return { sources, suggestions, text, finishReason, errorCode, citationStats: stats };
}

async function main() {
  const datasetPath = process.argv[2] || "openspec/changes/add-ai-docs-assistant/evaluation/retrieval-v1.json";
  const outputPath = process.argv[3] || "openspec/changes/add-ai-docs-assistant/evidence/phase-d-e2e-evaluation.json";
  const manifestPath = process.argv[4] || "public/llms.manifest.json";
  const assistantUrl = process.env.ASSISTANT_URL || "http://127.0.0.1:3000";

  const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const trustedUrls = new Set(manifest.entries.map(({ url }) => url));
  const trustedIdentities = new Set(manifest.entries.map(({ url, anchor }) => `${url}#${anchor}`));

  const results = [];
  for (const item of dataset.cases) {
    const outcome = await runCase(item, { assistantUrl, fetchImpl: fetch });
    const identities = outcome.sources.map(({ url, anchor }) => `${url}#${anchor}`);
    results.push({
      id: item.id,
      tags: item.tags,
      label: item.label,
      requiredAnswerPoints: item.requiredAnswerPoints,
      question: item.question,
      answerText: outcome.text,
      sourceIds: outcome.sources.map((source) => source.id),
      finishReason: outcome.finishReason,
      errorCode: outcome.errorCode,
      urlValid: identities.every((identity) => trustedUrls.has(identity.split("#", 1)[0])),
      anchorValid: identities.every((identity) => trustedIdentities.has(identity)),
      citationStats: outcome.citationStats,
      abstained: item.label === "abstain" ? abstentionOk(outcome.text, outcome.sources) : null,
      // Filled in by two human reviewers; automated run only annotates evidence above.
      reviewerACorrect: null,
      reviewerBCorrect: null,
      reviewerNotes: "",
    });
  }

  const withCitations = results.filter((row) => row.citationStats.cited > 0);
  const abstainRows = results.filter((row) => row.label === "abstain");
  const citationValidity = withCitations.length
    ? withCitations.reduce((sum, row) => sum + row.citationStats.valid, 0) /
      withCitations.reduce((sum, row) => sum + row.citationStats.cited, 0)
    : null;
  const report = {
    status: "automated-pass-pending-human-review",
    datasetVersion: dataset.datasetVersion,
    promptVersion: dataset.promptVersion,
    assistantUrl,
    cases: results.length,
    urlValidity: results.length ? results.filter((row) => row.urlValid).length / results.length : null,
    anchorValidity: results.length ? results.filter((row) => row.anchorValid).length / results.length : null,
    citationValidity,
    zeroFabricatedCitations: results.every((row) => row.citationStats.unknown === 0),
    abstentionPrecision: abstainRows.length
      ? abstainRows.filter((row) => row.abstained).length / abstainRows.length
      : null,
    errorCount: results.filter((row) => row.errorCode).length,
    results,
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    cases: report.cases,
    urlValidity: report.urlValidity,
    anchorValidity: report.anchorValidity,
    citationValidity: report.citationValidity,
    abstentionPrecision: report.abstentionPrecision,
    errorCount: report.errorCount,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
