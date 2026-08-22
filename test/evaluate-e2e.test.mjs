import assert from "node:assert/strict";
import test from "node:test";
import { abstentionOk, citationStats } from "../scripts/evaluate-e2e.mjs";

test("citationStats separates valid current-request IDs from unknown ones", () => {
  assert.deepEqual(citationStats("answer [S1] and [S3]", ["S1", "S2"]), { cited: 2, valid: 1, unknown: 1 });
  assert.deepEqual(citationStats("no citations here", ["S1"]), { cited: 0, valid: 0, unknown: 0 });
});

test("abstentionOk requires the exact deterministic text and zero sources", () => {
  assert.equal(abstentionOk("منبع کافی پیدا نشد", []), true);
  assert.equal(abstentionOk("منبع کافی پیدا نشد", [{ id: "S1" }]), false);
  assert.equal(abstentionOk("something else", []), false);
});
