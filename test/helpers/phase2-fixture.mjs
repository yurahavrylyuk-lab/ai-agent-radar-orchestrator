import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createInitialState } from "../../src/coordinator.mjs";
import { sha256Canonical } from "../../src/contracts.mjs";
import { createRoleTask, emptyEvidence } from "../../src/task-renderer.mjs";
import { resultContextForTask } from "../../src/validate.mjs";
import { attestedValidationEntries } from "../../src/validation-evidence.mjs";

export const OID_A = "a".repeat(40);
export const OID_B = "b".repeat(40);
export const DIGEST = "d".repeat(64);
export const approval = Object.freeze({ approvalId: "gov-002-test", scope: "Add the offline guide only.", allowedChanges: [{ path: "docs/learning/offline-fixture-reading.md", operation: "ADD" }], forbiddenChanges: ["No network", "No providers"], acceptanceCriteria: [{ id: "criterion", description: "The offline guide is bounded." }], validationRequirements: [{ id: "recipe", description: "Validate the bounded guide." }, { id: "scope-recipe", description: "Validate candidate scope and identity." }] });

export function runtimeDirectory(prefix) {
  const base = path.resolve(".runtime/tests"); fs.mkdirSync(base, { recursive: true }); return fs.mkdtempSync(path.join(base, `${prefix}-${crypto.randomUUID()}-`));
}
export function makeResult(task, payload, outcome = "COMPLETED") { return { schemaVersion: 2, taskDigest: task.taskDigest, context: resultContextForTask(task), outcome, payload }; }
export function analystState(root, { iteration = 1, reviewCommit = OID_B, timing = true } = {}) {
  const state = createInitialState({ controllerId: "controller", repositoryId: "fixture-repository", evidenceMode: "SIMULATED", ownerId: "owner", targetRoot: root, approval });
  const planContent = { goal: "guide", scope: approval.scope, allowedChanges: approval.allowedChanges, forbiddenChanges: approval.forbiddenChanges, acceptanceCriteria: approval.acceptanceCriteria, validationRequirements: approval.validationRequirements, risks: [], rationale: "bounded", resolvesFindingIds: [] };
  const plan = { revision: iteration, digest: sha256Canonical(planContent), content: planContent };
  const cycle = { id: "cycle", requestId: "request", status: "AWAITING_HUMAN_ROLE", stage: "ANALYST_REVIEW", targetRoot: root, targetBranch: "self-improvement", baselineCommit: OID_A, expectedTargetTip: OID_A, iterationBaseCommit: iteration === 1 ? OID_A : reviewCommit, iteration, planRevision: iteration, candidateCommit: reviewCommit, analystResultDigest: null, architectDecision: null, integrationStatus: "NOT_STARTED", createdAt: "2026-09-21T00:00:00.000Z" };
  const checkpoint = { receiptId: `checkpoint:${iteration}`, taskId: `builder:${iteration}`, workspaceId: `builder-${iteration}`, parentCommit: iteration === 1 ? OID_A : reviewCommit, candidateCommit: reviewCommit, treeId: "c".repeat(40), scopeDigest: "e".repeat(64), createdAt: cycle.createdAt };
  state.cycles.push(cycle); state.activeCycleId = cycle.id; state.plans.push({ cycleId: cycle.id, ...plan, architectResultDigest: DIGEST, createdAt: cycle.createdAt }); state.checkpointReceipts.push(checkpoint); state.iterations.push({ id: `iteration:${iteration}`, cycleId: cycle.id, index: iteration, planRevision: iteration, candidateCommit: reviewCommit, checkpointReceiptId: checkpoint.receiptId, reviewResultDigest: null });
  const task = createRoleTask({ controllerId: state.controllerId, repositoryId: state.repositoryId, evidenceMode: state.evidenceMode, cycleId: cycle.id, taskId: `analyst:${iteration}`, iteration, planRevision: iteration, role: "analyst", purpose: "ANALYST_REVIEW", binding: { ownerId: "owner", ownerGeneration: 1, issuedStateVersion: 0, baselineCommit: OID_A, iterationBaseCommit: cycle.iterationBaseCommit, expectedTargetBranch: "self-improvement", expectedTargetTip: OID_A, workspaceId: `analyst-${iteration}`, candidateCommit: reviewCommit, reviewedCommit: reviewCommit }, authorization: approval, plan, previousEvidence: emptyEvidence(), createdAt: cycle.createdAt });
  state.tasks.push(task); state.pendingTaskId = task.taskId; if (timing) state.timings.push({ taskId: task.taskId, status: "COMPLETED", waitingStartedAt: cycle.createdAt, startedAt: "2026-09-21T00:00:01.000Z", finishedAt: "2026-09-21T00:00:02.000Z", activeMs: 1000, waitingMs: 1000 }); return { state, task };
}
export function analystPayload(state, task, reviewState) { const validationOutcome = ["PASS", "PASS_WITH_RECOMMENDATIONS"].includes(reviewState) ? "PASS" : "FAIL"; return { reviewedCommit: task.binding.reviewedCommit, reviewState, findings: reviewState === "PASS" ? [] : ["finding"], requiredChanges: reviewState === "REVISE" ? ["change"] : [], recommendations: reviewState === "PASS_WITH_RECOMMENDATIONS" ? ["recommendation"] : [], validation: attestedValidationEntries(state, task, validationOutcome) }; }
