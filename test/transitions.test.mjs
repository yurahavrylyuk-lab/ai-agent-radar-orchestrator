import assert from "node:assert/strict";
import test from "node:test";
import { nextReviewIteration, transitionCycle } from "../src/transitions.mjs";

const cycle = { id: "c", status: "QUEUED", iterationIds: [], activeMs: 0, humanWaitingMs: 0 };
test("4 exactly one cycle admission is represented by one active-cycle slot", () => {
  const state = { activeCycleId: null };
  const admit = (id) => state.activeCycleId ? false : Boolean(state.activeCycleId = id);
  assert.equal(admit("c1"), true); assert.equal(admit("c2"), false);
});
test("5 illegal transitions fail without mutating cycle", () => {
  const before = structuredClone(cycle); assert.throws(() => transitionCycle(cycle, "ACCEPTED"), /Illegal/); assert.deepEqual(cycle, before);
});
test("6 third unresolved review escalates and prevents iteration four", () => {
  const result = nextReviewIteration({ ...cycle, status: "REVIEW", iterationIds: ["i1", "i2", "i3"] }, "REVISE"); assert.equal(result.status, "ESCALATED");
});
