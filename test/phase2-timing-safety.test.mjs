import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createRoleTask, emptyEvidence } from "../src/task-renderer.mjs";
import { initializeStateV2, readState, replaceStateAtomic } from "../src/local-store.mjs";
import { finishRole, startRole } from "../src/role-timing.mjs";
import { submitRoleResult } from "../src/result-submission.mjs";
import { resultContextForTask } from "../src/validate.mjs";
import { analystPayload, analystState, approval, makeResult, OID_A, runtimeDirectory } from "./helpers/phase2-fixture.mjs";

function fixture(options = {}) { const root = runtimeDirectory("timing-safety"); const statePath = path.join(root, "state.json"); const built = analystState(root, options); initializeStateV2(statePath, built.state); return { statePath, ...built }; }
function submit(item, result) { return submitRoleResult({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, result, now: "2026-09-21T00:10:00.000Z" }); }

test("submission rejects missing timing and still-open execution", () => {
  const missing = fixture({ timing: false }); assert.throws(() => submit(missing, makeResult(missing.task, analystPayload(missing.state, missing.task, "PASS"))), /ROLE_TIMING_REQUIRED/);
  const open = fixture({ timing: false }); open.state.timings.push({ taskId: open.task.taskId, status: "EXECUTING", waitingStartedAt: open.task.createdAt, startedAt: "2026-09-21T00:00:01.000Z", finishedAt: null, activeMs: 0, waitingMs: 1000 }); replaceStateAtomic(open.statePath, open.state); assert.throws(() => submit(open, makeResult(open.task, analystPayload(open.state, open.task, "PASS"))), /ROLE_EXECUTION_STILL_OPEN/);
});

test("submission rejects role execution over 15 minutes", () => {
  const item = fixture(); item.state.timings[0].activeMs = 900001; replaceStateAtomic(item.statePath, item.state); assert.throws(() => submit(item, makeResult(item.task, analystPayload(item.state, item.task, "PASS"))), /ROLE_EXECUTION_LIMIT_EXCEEDED/);
});

test("timing hold permits a BLOCKED disposition that closes the cycle", () => {
  const item = fixture({ timing: false }); startRole({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, taskId: item.task.taskId, now: "2026-09-21T00:00:00.000Z" }); finishRole({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, taskId: item.task.taskId, now: "2026-09-21T00:16:00.001Z" });
  const blocked = makeResult(item.task, { code: "TIME_LIMIT", explanation: "The authorized execution limit was exceeded.", evidence: ["completed timing record"] }, "BLOCKED"); submit(item, blocked); const state = readState(item.statePath); assert.equal(state.cycles[0].status, "HALTED"); assert.equal(state.summaries.filter((summary) => summary.type === "FINAL").length, 1);
});

test("submission rejects cumulative active-cycle execution over 90 minutes but excludes human waiting", () => {
  const over = fixture();
  for (let index = 0; index < 6; index += 1) {
    const task = createRoleTask({ controllerId: over.state.controllerId, repositoryId: over.state.repositoryId, evidenceMode: over.state.evidenceMode, cycleId: "cycle", taskId: `prior:${index}`, iteration: 1, planRevision: 1, role: "architect", purpose: "ARCHITECT_PLAN", binding: { ownerId: "owner", ownerGeneration: 1, issuedStateVersion: 0, baselineCommit: OID_A, iterationBaseCommit: OID_A, expectedTargetBranch: "self-improvement", expectedTargetTip: OID_A, workspaceId: null, candidateCommit: null, reviewedCommit: null }, authorization: approval, plan: { revision: 1, digest: null, content: null }, previousEvidence: emptyEvidence(), createdAt: "2026-09-21T00:00:00.000Z" });
    over.state.tasks.push(task); over.state.timings.push({ taskId: task.taskId, status: "COMPLETED", waitingStartedAt: task.createdAt, startedAt: "2026-09-21T00:00:01.000Z", finishedAt: "2026-09-21T00:15:01.000Z", activeMs: 900000, waitingMs: 86_400_000 });
  }
  replaceStateAtomic(over.statePath, over.state); assert.throws(() => submit(over, makeResult(over.task, analystPayload(over.state, over.task, "PASS"))), /CYCLE_EXECUTION_LIMIT_EXCEEDED/);
  const waiting = fixture(); waiting.state.timings[0].waitingMs = 99_000_000; replaceStateAtomic(waiting.statePath, waiting.state); assert.equal(submit(waiting, makeResult(waiting.task, analystPayload(waiting.state, waiting.task, "PASS"))).value.status, "ACCEPTED");
});

test("identical replay remains idempotent while held", () => {
  const item = fixture(); const result = makeResult(item.task, analystPayload(item.state, item.task, "PASS")); submit(item, result); const held = readState(item.statePath); held.humanHold = true; replaceStateAtomic(item.statePath, held); const replay = submit(item, result); assert.equal(replay.value.status, "IDEMPOTENT_REPLAY");
});

test("held workflow permits only timed Architect disposition", () => {
  const item = fixture(); submit(item, makeResult(item.task, analystPayload(item.state, item.task, "REJECT"))); let state = readState(item.statePath); assert.equal(state.humanHold, true); const task = state.tasks.find((candidate) => candidate.taskId === state.pendingTaskId);
  startRole({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:10:01.000Z" }); finishRole({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:10:02.000Z" }); state = readState(item.statePath);
  const result = { schemaVersion: 2, taskDigest: task.taskDigest, context: resultContextForTask(task), outcome: "COMPLETED", payload: { reviewedCommit: task.binding.reviewedCommit, analystResultDigest: state.cycles[0].analystResultDigest, decision: "HUMAN_REVIEW", rationale: "Escalate the rejected candidate.", recommendationDispositions: [] } };
  submitRoleResult({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, result, now: "2026-09-21T00:10:03.000Z" }); state = readState(item.statePath); assert.equal(state.cycles[0].status, "ESCALATED"); assert.equal(state.summaries.filter((summary) => summary.type === "FINAL").length, 1);
});
