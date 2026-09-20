import assert from "node:assert/strict";
import test from "node:test";
import { quotaDecision, roleExecutionAllowed } from "../src/eligibility.mjs";
import { executePaidRole } from "../src/adapters/paid-disabled.mjs";
import { fakeModel } from "../src/adapters/fake-model.mjs";
import { createTerminalSummary } from "../src/summaries.mjs";

test("7 unknown, exhausted, stale, insufficient, and unprotected quota refuse", () => {
  const base = { known: true, exhausted: false, remaining: 2, estimated: 1, overageProtected: true };
  for (const quota of [{}, { ...base, exhausted: true }, { ...base, stale: true }, { ...base, remaining: 0 }, { ...base, overageProtected: false }]) assert.equal(quotaDecision(quota).allowed, false);
});
test("8 offline summary rendering requires no external quota", () => {
  const summary = createTerminalSummary({ id: "c", status: "ACCEPTED", iterationIds: [] }, "now"); assert.equal(summary.simulated, true);
});
test("9 paid adapter always refuses even with credential-like environment", () => {
  process.env.SYNTHETIC_PAID_KEY = "not-a-real-secret"; assert.deepEqual(executePaidRole(), { status: "PAID_EXECUTION_FORBIDDEN" }); delete process.env.SYNTHETIC_PAID_KEY;
});
test("10 unavailable model never falls back", () => {
  assert.deepEqual(fakeModel({ available: false }).invoke(), { status: "MODEL_UNAVAILABLE", fallback: false });
  assert.equal(roleExecutionAllowed({ quota: {}, modelAvailable: false }).allowed, false);
});
