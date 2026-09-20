import assert from "node:assert/strict";
import test from "node:test";
import { createIterationSummary, createTerminalSummary, exportAudit } from "../src/summaries.mjs";

test("23 every Analyst result creates one deterministic iteration summary", () => {
  const iteration = { cycleId: "c", index: 1, reviewState: "REVISE" }; assert.deepEqual(createIterationSummary(iteration, "now"), createIterationSummary(iteration, "now"));
});
test("24 accepted, rejected, escalated, and halted cycles have accurate summaries", () => {
  for (const status of ["ACCEPTED", "REJECTED", "ESCALATED", "HALTED"]) assert.equal(createTerminalSummary({ id: "c", status, iterationIds: [] }, "now").status, status);
});
test("25 repeated audit export changes nothing", () => {
  const summaries = [{ id: "s" }], events = [{ id: "e" }]; assert.deepEqual(exportAudit(summaries, events), exportAudit(summaries, events)); assert.deepEqual(summaries, [{ id: "s" }]);
});
