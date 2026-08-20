// ponytail: hardcoded price table (USD per 1K tokens). Edit when models change.
const PRICES = {
  "gpt-4o": { in: 0.0025, out: 0.01 },
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "gpt-4.1": { in: 0.002, out: 0.008 },
  "gpt-4.1-mini": { in: 0.0004, out: 0.0016 },
};

export function estimateCost(model, promptTokens, completionTokens) {
  if (!model || promptTokens == null || completionTokens == null) return null;
  const p = PRICES[model];
  if (!p) return null;
  return (promptTokens / 1000) * p.in + (completionTokens / 1000) * p.out;
}
