import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { initializeStateV2, readState } from "../src/local-store.mjs";
import { finishRole, startRole } from "../src/role-timing.mjs";
import { submitRoleResult } from "../src/result-submission.mjs";
import { analystPayload, analystState, makeResult, OID_B, runtimeDirectory } from "./helpers/phase2-fixture.mjs";

function fixture(options = {}) { const root = runtimeDirectory("lifecycle"); const statePath = path.join(root, "state.json"); const built = analystState(root, options); initializeStateV2(statePath, built.state); return { root, statePath, ...built }; }
const submit = (statePath, result, persistenceOptions = {}) => submitRoleResult({ statePath, ownerId: "owner", ownerGeneration: 1, result, now: "2026-09-21T00:01:00.000Z", persistenceOptions });

test("all five Analyst outcomes produce one immutable summary and deterministic next state", () => {
  const expectations = { PASS: ["ARCHITECT_FINAL_DECISION", false], PASS_WITH_RECOMMENDATIONS: ["ARCHITECT_FINAL_DECISION", false], REVISE: ["ARCHITECT_REVISION", false], REJECT: ["ARCHITECT_FINAL_DECISION", true], HUMAN_REVIEW_REQUIRED: ["ARCHITECT_FINAL_DECISION", true] };
  for (const [reviewState, [purpose, hold]] of Object.entries(expectations)) {
    const { statePath, task } = fixture(); submit(statePath, makeResult(task, analystPayload(OID_B, reviewState))); const state = readState(statePath);
    assert.equal(state.summaries.length, 1, reviewState); assert.equal(state.reviews.length, 1); assert.equal(state.outbox.length, 1); assert.equal(state.humanHold, hold); assert.equal(state.tasks.find((item) => item.taskId === state.pendingTaskId).purpose, purpose);
  }
});
test("third unresolved review creates disposition task, engages hold, and never creates iteration four", () => {
  const { statePath, task } = fixture({ iteration: 3 }); submit(statePath, makeResult(task, analystPayload(OID_B, "REVISE"))); const state = readState(statePath);
  assert.equal(state.humanHold, true); assert.equal(state.cycles[0].iteration, 3); assert.equal(state.tasks.at(-1).purpose, "ARCHITECT_FINAL_DECISION"); assert.equal(state.summaries.length, 1);
});
test("identical replay returns the original receipt without changing bytes; conflicting replay fails closed", () => {
  const { statePath, task } = fixture(); const result = makeResult(task, analystPayload(OID_B, "PASS")); const first = submit(statePath, result).value; const bytes = fs.readFileSync(statePath);
  const replay = submit(statePath, result).value; assert.equal(replay.receiptId, first.receiptId); assert.equal(replay.status, "IDEMPOTENT_REPLAY"); assert.deepEqual(fs.readFileSync(statePath), bytes);
  assert.throws(() => submit(statePath, { ...result, payload: { ...result.payload, recommendations: ["different"] } }), /CONFLICTING_RESULT_RESUBMISSION/); assert.deepEqual(fs.readFileSync(statePath), bytes);
});
test("timing updates preserve task identity, distinguish waiting/executing, and do not stale a result", () => {
  const { statePath, task } = fixture(); const digest = task.taskDigest; startRole({ statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:00:10.000Z" });
  assert.equal(readState(statePath).timings[0].status, "EXECUTING"); finishRole({ statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:00:20.000Z" });
  assert.equal(readState(statePath).tasks[0].taskDigest, digest); submit(statePath, makeResult(task, analystPayload(OID_B, "PASS"))); assert.equal(readState(statePath).receipts.length, 1);
});
test("role time limit creates a durable human hold", () => {
  const { statePath, task } = fixture(); startRole({ statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:00:00.000Z" }); finishRole({ statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:16:00.001Z" }); assert.equal(readState(statePath).humanHold, true);
});
test("review, summary, outbox, receipt, and next task are one durable transaction", () => {
  const { statePath, task } = fixture(); const result = makeResult(task, analystPayload(OID_B, "PASS")); const before = fs.readFileSync(statePath);
  assert.throws(() => submit(statePath, result, { onOperation(operation) { if (operation === "temporary-write") throw new Error("INJECTED_PRE_WRITE_FAILURE"); } }), /INJECTED_PRE_WRITE_FAILURE/); assert.deepEqual(fs.readFileSync(statePath), before);
  assert.throws(() => submit(statePath, result, { failBeforeRename: true }), /INJECTED_PERSISTENCE_FAILURE/); assert.deepEqual(fs.readFileSync(statePath), before);
  assert.throws(() => submit(statePath, result, { failAfterRename: true }), /PERSISTENCE_DURABILITY_UNCERTAIN/); const after = readState(statePath); assert.deepEqual([after.reviews.length, after.summaries.length, after.outbox.length, after.receipts.length], [1, 1, 1, 1]);
});
test("BLOCKED creates a durable hold and no downstream task", () => {
  const { statePath, task } = fixture(); const result = makeResult(task, { code: "NEEDS_HUMAN", explanation: "Bounded task cannot proceed.", evidence: ["local evidence"] }, "BLOCKED"); submit(statePath, result); const state = readState(statePath); assert.equal(state.humanHold, true); assert.equal(state.pendingTaskId, null); assert.equal(state.cycles[0].status, "HALTED");
});
