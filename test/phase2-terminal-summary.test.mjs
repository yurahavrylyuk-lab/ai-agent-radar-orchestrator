import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { initializeStateV2, readState } from "../src/local-store.mjs";
import { finishRole, startRole } from "../src/role-timing.mjs";
import { submitRoleResult } from "../src/result-submission.mjs";
import { resultContextForTask } from "../src/validate.mjs";
import { analystPayload, analystState, makeResult, runtimeDirectory } from "./helpers/phase2-fixture.mjs";

function fixture(options = {}) { const root = runtimeDirectory("terminal-summary"); const statePath = path.join(root, "state.json"); const built = analystState(root, options); initializeStateV2(statePath, built.state); return { statePath, ...built }; }
function submit(item, result, now = "2026-09-21T00:01:00.000Z") { return submitRoleResult({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, result, now }); }
function finalDecision(item, reviewState, decision) {
  submit(item, makeResult(item.task, analystPayload(item.state, item.task, reviewState))); let state = readState(item.statePath); const task = state.tasks.find((candidate) => candidate.taskId === state.pendingTaskId);
  startRole({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:01:01.000Z" }); finishRole({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:01:02.000Z" }); state = readState(item.statePath);
  const result = { schemaVersion: 2, taskDigest: task.taskDigest, context: resultContextForTask(task), outcome: "COMPLETED", payload: { reviewedCommit: task.binding.reviewedCommit, analystResultDigest: state.cycles[0].analystResultDigest, decision, rationale: `Terminal ${decision}.`, recommendationDispositions: [] } };
  const receipt = submit(item, result, "2026-09-21T00:01:03.000Z"); return { result, receipt };
}

test("BLOCKED result atomically creates one immutable terminal summary and outbox event", () => {
  const item = fixture(); const blocked = makeResult(item.task, { code: "LOCAL_BLOCK", explanation: "The bounded role cannot continue.", evidence: ["offline evidence"] }, "BLOCKED"); submit(item, blocked); const state = readState(item.statePath); const summary = state.summaries.find((entry) => entry.type === "FINAL"); assert.equal(state.cycles[0].status, "HALTED"); assert.equal(summary.terminalReason, "BLOCKED:LOCAL_BLOCK"); assert.equal(summary.evidenceChain.at(-1).id, item.task.taskId); assert.equal(state.outbox.filter((event) => event.payload.summaryId === summary.id).length, 1);
});

test("Architect REJECT and HUMAN_REVIEW each create exactly one terminal summary", () => {
  for (const [reviewState, decision, expected] of [["PASS", "REJECT", "REJECTED"], ["REJECT", "HUMAN_REVIEW", "ESCALATED"]]) {
    const item = fixture(); const { result } = finalDecision(item, reviewState, decision); let state = readState(item.statePath); assert.equal(state.cycles[0].status, expected); assert.equal(state.summaries.filter((summary) => summary.type === "FINAL").length, 1); assert.equal(state.outbox.filter((event) => event.id.endsWith(":final")).length, 1);
    const replay = submit(item, result, "2026-09-21T00:02:00.000Z"); assert.equal(replay.value.status, "IDEMPOTENT_REPLAY"); state = readState(item.statePath); assert.equal(state.summaries.filter((summary) => summary.type === "FINAL").length, 1); assert.equal(state.outbox.filter((event) => event.id.endsWith(":final")).length, 1);
  }
});

test("iteration-limit disposition creates an ESCALATED final summary without iteration four", () => {
  const item = fixture({ iteration: 3 }); finalDecision(item, "REVISE", "HUMAN_REVIEW"); const state = readState(item.statePath); assert.equal(state.cycles[0].iteration, 3); assert.equal(state.cycles[0].status, "ESCALATED"); assert.equal(state.summaries.filter((summary) => summary.type === "FINAL").length, 1); assert.equal(state.tasks.some((task) => task.iteration === 4), false);
});
