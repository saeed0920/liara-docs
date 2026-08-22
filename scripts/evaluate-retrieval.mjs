import { readFile, writeFile } from "node:fs/promises";

const datasetPath = process.argv[2] || "openspec/changes/add-ai-docs-assistant/evaluation/retrieval-v1.json";
const outputPath = process.argv[3] || "openspec/changes/add-ai-docs-assistant/evidence/phase-b-retrieval-evaluation.json";
const manifestPath = process.argv[4] || "public/llms.manifest.json";
const engineUrl = process.env.ENGINE_URL || "http://127.0.0.1:3100";
const token = process.env.ENGINE_API_TOKEN;
const candidateCollection = process.env.CANDIDATE_COLLECTION;
if (!token || !candidateCollection) throw new Error("ENGINE_API_TOKEN and CANDIDATE_COLLECTION are required");

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const trustedUrls = new Set(manifest.entries.map(({ url }) => url));
const trustedIdentities = new Set(manifest.entries.map(({ url, anchor }) => `${url}#${anchor}`));
const results = [];
for (const item of dataset.cases) {
  const response = await fetch(`${engineUrl}/retrieve`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-request-timeout-ms": "10000" },
    body: JSON.stringify({ query: item.question, page_path: item.pagePath, limit: 5 }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${item.id}: HTTP ${response.status}`);
  const body = await response.json();
  const returned = body.sources.map(({ url, anchor }) => `${url}#${anchor}`);
  const expected = item.expectedSources.map(({ url, anchor }) => `${url}#${anchor}`);
  const matched = expected.filter((identity) => returned.includes(identity));
  results.push({
    id: item.id,
    tags: item.tags,
    label: item.label,
    expected,
    returned,
    matched: matched.length,
    insufficientContext: body.insufficient_context,
  });
}

function recall(rows) {
  const expected = rows.reduce((count, row) => count + row.expected.length, 0);
  const matched = rows.reduce((count, row) => count + row.matched, 0);
  return expected ? matched / expected : null;
}
const answerRows = results.filter((row) => row.expected.length);
const abstainRows = results.filter((row) => row.label === "abstain");
const abstained = abstainRows.filter((row) => row.insufficientContext && row.returned.length === 0).length;
const returnedIdentities = results.flatMap((row) => row.returned);
const urlValidity = returnedIdentities.length
  ? returnedIdentities.filter((identity) => trustedUrls.has(identity.split("#", 1)[0])).length / returnedIdentities.length
  : 1;
const anchorValidity = returnedIdentities.length
  ? returnedIdentities.filter((identity) => trustedIdentities.has(identity)).length / returnedIdentities.length
  : 1;
const report = {
  status: "completed",
  datasetVersion: dataset.datasetVersion,
  promptVersion: dataset.promptVersion,
  completionModel: dataset.completionModel,
  embeddingProvider: dataset.embeddingProvider,
  embeddingModel: dataset.embeddingModel,
  embeddingDimension: dataset.embeddingDimension,
  chunkerVersion: dataset.chunkerVersion,
  retrievalVersion: dataset.retrievalVersion,
  fusionVersion: dataset.fusionVersion,
  thresholdVersion: dataset.thresholdVersion,
  evaluatorVersion: dataset.evaluatorVersion,
  corpusNamespace: dataset.corpusNamespace,
  corpusDigest: dataset.corpusDigest,
  candidateCollection,
  cases: results.length,
  recallAt5: recall(answerRows),
  subsetRecallAt5: Object.fromEntries(["simple", "complex", "multi-turn"].map((tag) => [tag, recall(answerRows.filter((row) => row.tags.includes(tag)))])),
  abstentionPrecision: abstainRows.length ? abstained / abstainRows.length : null,
  urlValidity,
  anchorValidity,
  sourceCapValid: results.every((row) => row.returned.length <= 5),
  gates: {
    recallAt5: recall(answerRows) >= 0.8,
    abstentionPrecision: abstainRows.length > 0 && abstained / abstainRows.length >= 0.95,
    urlValidity: urlValidity === 1,
    anchorValidity: anchorValidity === 1,
  },
  results,
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ cases: report.cases, recallAt5: report.recallAt5, abstentionPrecision: report.abstentionPrecision }));
