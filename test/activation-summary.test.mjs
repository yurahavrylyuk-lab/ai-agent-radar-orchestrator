import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { admitRealPilotRequest } from "../src/real-pilot-admission.mjs";
import { commitPilotAuthorization, preparePilotAuthorization } from "../src/pilot-authorization.mjs";
import { readState } from "../src/local-store.mjs";
import { finishRole, startRole } from "../src/role-timing.mjs";
import { submitRoleResult } from "../src/result-submission.mjs";
import { resultContextForTask } from "../src/validate.mjs";
import { activationFixture } from "./helpers/activation-fixture.mjs";

test("negative real-pilot terminal result closes authorization and creates one HUMAN_ASSISTED final summary", () => {
  const fixture = activationFixture("activation-negative-summary");
  const proposal = preparePilotAuthorization({ statePath: fixture.statePath, request: fixture.request, humanApproval: fixture.approval, controllerRoot: fixture.controller.root, now: "2026-09-22T10:00:00.000Z" });
  commitPilotAuthorization({ statePath: fixture.statePath, proposal, confirmation: `CONFIRM ${proposal.grant.authorizationDigest}` });
  admitRealPilotRequest({ statePath: fixture.statePath, request: fixture.request, controllerRoot: fixture.controller.root, now: "2026-09-22T10:00:01.000Z" });
  const admitted = readState(fixture.statePath); const task = admitted.tasks[0]; const ownerId = admitted.owner.id; const ownerGeneration = admitted.owner.generation;
  startRole({ statePath: fixture.statePath, ownerId, ownerGeneration, taskId: task.taskId, now: "2026-09-22T10:00:02.000Z" });
  finishRole({ statePath: fixture.statePath, ownerId, ownerGeneration, taskId: task.taskId, now: "2026-09-22T10:00:03.000Z" });
  const result = { schemaVersion: 2, taskDigest: task.taskDigest, context: resultContextForTask(task), outcome: "BLOCKED", payload: { code: "BOUNDED_PLAN_UNAVAILABLE", explanation: "The bounded plan cannot be completed safely.", evidence: ["No target mutation was attempted."] } };
  submitRoleResult({ statePath: fixture.statePath, ownerId, ownerGeneration, result, now: "2026-09-22T10:00:04.000Z" });
  const bytes = fs.readFileSync(fixture.statePath); const state = readState(fixture.statePath); const summary = state.summaries.at(-1);
  assert.equal(state.authorizations[0].lifecycle.status, "CLOSED"); assert.equal(state.activeCycleId, null); assert.equal(state.cycles[0].status, "HALTED");
  assert.equal(summary.type, "FINAL"); assert.equal(summary.evidenceMode, "HUMAN_ASSISTED"); assert.equal(summary.terminalReason, "BLOCKED:BOUNDED_PLAN_UNAVAILABLE"); assert.equal(summary.integration.status, "NOT_ATTEMPTED"); assert.equal(summary.protectedTargetComparison.status, "NO_TARGET_MUTATION");
  assert.deepEqual(summary.candidateCommits, []); assert.equal(summary.architectDecisions.length, 1); assert.equal(summary.architectDecisions[0].purpose, "ARCHITECT_PLAN"); assert.equal(summary.architectDecisions[0].decision, null); assert.equal(state.outbox.length, 1); assert.equal(state.outbox[0].status, "SIMULATED_ACCEPTED");
  const replay = submitRoleResult({ statePath: fixture.statePath, ownerId, ownerGeneration, result, now: "2026-09-22T10:00:05.000Z" }).value; assert.equal(replay.status, "IDEMPOTENT_REPLAY"); assert.deepEqual(fs.readFileSync(fixture.statePath), bytes);
});
