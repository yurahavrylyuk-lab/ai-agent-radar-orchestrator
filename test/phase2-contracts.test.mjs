import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, parseJsonStrict, sha256Canonical } from "../src/contracts.mjs";
import { createRoleTask, emptyEvidence } from "../src/task-renderer.mjs";
import { resultContextForTask, validateRoleResultV2, validateRoleTask } from "../src/validate.mjs";
import { OID_A, approval } from "./helpers/phase2-fixture.mjs";

function initialTask() { return createRoleTask({ controllerId: "controller", repositoryId: "repository", evidenceMode: "SIMULATED", cycleId: "cycle", taskId: "task", iteration: 1, planRevision: 1, role: "architect", purpose: "ARCHITECT_PLAN", binding: { ownerId: "owner", ownerGeneration: 1, issuedStateVersion: 1, baselineCommit: OID_A, iterationBaseCommit: OID_A, expectedTargetBranch: "self-improvement", expectedTargetTip: OID_A, workspaceId: null, candidateCommit: null, reviewedCommit: null }, authorization: approval, plan: { revision: 1, digest: null, content: null }, previousEvidence: emptyEvidence(), createdAt: "2026-09-21T00:00:00.000Z" }); }

test("Phase 2 canonical JSON sorts recursively, preserves arrays, and rejects non-JSON values", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: [2, 1], x: true } }), '{"a":{"x":true,"y":[2,1]},"z":1}');
  assert.equal(sha256Canonical({ b: 2, a: 1 }), sha256Canonical({ a: 1, b: 2 }));
  assert.throws(() => canonicalJson({ x: undefined }), /finite JSON/);
});
test("Phase 2 strict parser rejects duplicate keys and trailing content", () => {
  assert.throws(() => parseJsonStrict('{"a":1,"a":2}'), /duplicate JSON key/); assert.throws(() => parseJsonStrict('{}{}'), /trailing/); assert.deepEqual(parseJsonStrict('{"a":[1,true,null]}'), { a: [1, true, null] });
});
test("role tasks bind the exact envelope with full identities and fixed restrictions", () => {
  const task = initialTask(); assert.equal(validateRoleTask(task), true); assert.match(task.taskDigest, /^[0-9a-f]{64}$/u); assert.equal(task.limits.network, false);
  assert.throws(() => validateRoleTask({ ...task, taskDigest: "0".repeat(64) }), /does not match/);
  assert.throws(() => validateRoleTask({ ...task, extra: true }), /unknown field/);
  assert.throws(() => validateRoleTask({ ...task, binding: { ...task.binding, baselineCommit: "short" } }), /SHA-1/);
});
test("role results require exact echoed context and reject unknown or malformed evidence", () => {
  const task = initialTask(); const payload = { goal: "goal", scope: approval.scope, allowedChanges: approval.allowedChanges, forbiddenChanges: approval.forbiddenChanges, acceptanceCriteria: approval.acceptanceCriteria, validationRequirements: approval.validationRequirements, risks: [], rationale: "why", resolvesFindingIds: [] };
  const result = { schemaVersion: 2, taskDigest: task.taskDigest, context: resultContextForTask(task), outcome: "COMPLETED", payload }; assert.equal(validateRoleResultV2(result, task), true);
  assert.throws(() => validateRoleResultV2({ ...result, context: { ...result.context, repositoryId: "wrong" } }, task), /exactly echo/);
  assert.throws(() => validateRoleResultV2({ ...result, payload: { ...payload, command: "rm" } }, task), /unknown field/);
});
