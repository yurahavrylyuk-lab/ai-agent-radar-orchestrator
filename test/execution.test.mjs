import assert from "node:assert/strict";
import test from "node:test";
import { accountTime, uncertainCompletion, validateReviewTarget } from "../src/transitions.mjs";
import { prepareHumanTask } from "../src/adapters/human-assisted.mjs";

test("29 review identity mismatches and uncertain AI completion stop progression", () => {
  const expected = { cycleId: "c", planRevision: 2, builderCommit: "abc" }; assert.throws(() => validateReviewTarget(expected, { ...expected, builderCommit: "other" }), /MISMATCH/); assert.deepEqual(uncertainCompletion(), { status: "HALTED", reason: "UNCERTAIN_AI_COMPLETION", replay: false });
});
test("30 human dispatch waits without AI and time accounting separates waiting", () => {
  const task = prepareHumanTask({ role: "builder", instructions: "offline" }); assert.equal(task.status, "AWAITING_HUMAN_ROLE"); assert.equal(task.launched, false);
  const cycle = { status: "ACTIVE", activeMs: 0, humanWaitingMs: 0 }; const updated = accountTime(cycle, { activeMs: 15 * 60 * 1000, humanWaitingMs: 60 * 60 * 1000 }); assert.equal(updated.activeMs, 15 * 60 * 1000); assert.equal(updated.humanWaitingMs, 60 * 60 * 1000);
});
