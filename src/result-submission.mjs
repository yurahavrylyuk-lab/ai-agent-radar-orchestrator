import { canonicalJson, sha256Canonical } from "./contracts.mjs";
import { buildTask, finalizeTerminalCycle, findCycle, summaryDigest } from "./coordinator.mjs";
import { mutateStateV2 } from "./local-store.mjs";
import { assertSubmissionTiming } from "./role-timing.mjs";
import { validateRoleResultV2 } from "./validate.mjs";
import { validateRequiredValidationEvidence } from "./validation-evidence.mjs";

function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function resultRecord(task, result, resultDigest, now) { return { taskId: task.taskId, taskDigest: task.taskDigest, cycleId: task.cycleId, role: task.role, purpose: task.purpose, resultDigest, result: structuredClone(result), acceptedAt: now }; }
function receipt(task, resultDigest, stateVersion, now) { return { schemaVersion: 2, receiptId: `receipt:${task.taskId}`, taskId: task.taskId, taskDigest: task.taskDigest, resultDigest, acceptedAt: now, stateVersion, status: "ACCEPTED" }; }
function approvedPlanPayload(payload, task) {
  for (const field of ["scope", "allowedChanges", "forbiddenChanges", "acceptanceCriteria", "validationRequirements"]) if (!same(payload[field], task.authorization[field])) throw new Error(`ARCHITECT_PLAN_${field.toUpperCase()}_OUTSIDE_AUTHORIZATION`);
  return payload;
}
function issue(state, cycle, purpose, now, binding = {}) {
  const task = buildTask(state, cycle, purpose, now, binding); state.tasks.push(task); state.pendingTaskId = task.taskId; cycle.stage = purpose; cycle.status = "AWAITING_HUMAN_ROLE"; return task;
}
function workspaceId(cycle, role) { return `${role}-${sha256Canonical({ cycleId: cycle.id, iteration: cycle.iteration, planRevision: cycle.planRevision, role }).slice(0, 20)}`; }
function addReviewBundle(state, cycle, task, result, resultDigest, now) {
  const review = { id: `review:${task.taskId}`, cycleId: cycle.id, iteration: task.iteration, planRevision: task.planRevision, reviewedCommit: result.payload.reviewedCommit, reviewState: result.payload.reviewState, resultDigest, createdAt: now };
  state.reviews.push(review);
  const unsigned = { id: `summary:${cycle.id}:iteration:${task.iteration}`, cycleId: cycle.id, type: "ITERATION", iteration: task.iteration, planRevision: task.planRevision, candidateCommit: result.payload.reviewedCommit, reviewState: result.payload.reviewState, resultDigest, evidenceMode: state.evidenceMode, createdAt: now };
  const summary = { ...unsigned, digest: summaryDigest(unsigned) }; state.summaries.push(summary);
  state.outbox.push({ id: `${state.repositoryId}:${cycle.id}:${task.iteration}:review`, status: "SIMULATED_ACCEPTED", payload: { summaryId: summary.id, summaryDigest: summary.digest, simulated: true } });
  cycle.analystResultDigest = resultDigest; return summary;
}

export function submitRoleResult({ statePath, ownerId, ownerGeneration, result, now, persistenceOptions = {} }) {
  const resultDigest = sha256Canonical(result);
  return mutateStateV2({ statePath, ownerId, ownerGeneration, persistenceOptions, mutator(state) {
    const prior = state.results.find((item) => item.taskDigest === result.taskDigest);
    if (prior) {
      if (prior.resultDigest !== resultDigest) throw new Error("CONFLICTING_RESULT_RESUBMISSION");
      const priorReceipt = state.receipts.find((item) => item.taskId === prior.taskId); return { unchanged: true, value: { ...structuredClone(priorReceipt), status: "IDEMPOTENT_REPLAY" } };
    }
    const task = state.tasks.find((item) => item.taskDigest === result.taskDigest); if (!task) throw new Error("UNKNOWN_TASK_DIGEST");
    if (state.pendingTaskId !== task.taskId) throw new Error("STALE_OR_NONPENDING_RESULT");
    validateRoleResultV2(result, task);
    const disposition = result.outcome === "BLOCKED" || (task.purpose === "ARCHITECT_FINAL_DECISION" && result.outcome === "COMPLETED" && result.payload.decision !== "ACCEPT");
    if (state.humanHold && !disposition) throw new Error("HUMAN_HOLD");
    assertSubmissionTiming(state, task, { allowLimitExceeded: result.outcome === "BLOCKED" }); validateRequiredValidationEvidence(state, task, result);
    const cycle = findCycle(state, task.cycleId); const acceptedVersion = state.stateVersion + 1;
    const storedReceipt = receipt(task, resultDigest, acceptedVersion, now); state.results.push(resultRecord(task, result, resultDigest, now)); state.receipts.push(storedReceipt); state.pendingTaskId = null;
    if (result.outcome === "BLOCKED") { finalizeTerminalCycle(state, cycle, { status: "HALTED", stage: "BLOCKED", terminalReason: `BLOCKED:${result.payload.code}`, now }); state.stateVersion = acceptedVersion; return { state, value: storedReceipt }; }
    switch (task.purpose) {
      case "ARCHITECT_PLAN":
      case "ARCHITECT_REVISION": { const content = approvedPlanPayload(result.payload, task); const plan = { cycleId: cycle.id, revision: task.planRevision, content: structuredClone(content), digest: sha256Canonical(content), architectResultDigest: resultDigest, createdAt: now }; state.plans.push(plan); cycle.planRevision = plan.revision;
        if (task.purpose === "ARCHITECT_REVISION") { if (cycle.iteration >= 3) throw new Error("ITERATION_LIMIT_REACHED"); cycle.iteration += 1; cycle.iterationBaseCommit = cycle.candidateCommit; }
        issue(state, cycle, "BUILDER_IMPLEMENTATION", now, { workspaceId: workspaceId(cycle, "builder") }); break; }
      case "BUILDER_IMPLEMENTATION": { const checkpoint = state.checkpointReceipts.find((item) => item.taskId === task.taskId); if (!checkpoint) throw new Error("VERIFIED_CHECKPOINT_REQUIRED");
        if (checkpoint.candidateCommit !== result.payload.candidateCommit || checkpoint.parentCommit !== result.payload.parentCommit || checkpoint.treeId !== result.payload.treeId) throw new Error("BUILDER_RESULT_CHECKPOINT_MISMATCH");
        const expectedOperation = cycle.iteration === 1 ? "ADD" : "MODIFY"; if (result.payload.changedFiles.length !== 1 || result.payload.changedFiles[0].path !== "docs/learning/offline-fixture-reading.md" || result.payload.changedFiles[0].operation !== expectedOperation || result.payload.changedFiles[0].mode !== "100644") throw new Error("BUILDER_RESULT_SCOPE_MISMATCH");
        cycle.candidateCommit = checkpoint.candidateCommit; cycle.expectedTargetTip = cycle.baselineCommit;
        state.iterations.push({ id: `iteration:${cycle.id}:${cycle.iteration}`, cycleId: cycle.id, index: cycle.iteration, planRevision: cycle.planRevision, candidateCommit: checkpoint.candidateCommit, checkpointReceiptId: checkpoint.receiptId, reviewResultDigest: null });
        issue(state, cycle, "ANALYST_REVIEW", now, { candidateCommit: checkpoint.candidateCommit, reviewedCommit: checkpoint.candidateCommit, workspaceId: workspaceId(cycle, "analyst") }); break; }
      case "ANALYST_REVIEW": { const currentIteration = state.iterations.find((item) => item.cycleId === cycle.id && item.index === cycle.iteration); if (!currentIteration || currentIteration.candidateCommit !== result.payload.reviewedCommit) throw new Error("ANALYST_ITERATION_MISMATCH"); currentIteration.reviewResultDigest = resultDigest;
        addReviewBundle(state, cycle, task, result, resultDigest, now);
        if (result.payload.reviewState === "REVISE" && cycle.iteration < 3) { cycle.planRevision += 1; issue(state, cycle, "ARCHITECT_REVISION", now, { candidateCommit: cycle.candidateCommit, reviewedCommit: cycle.candidateCommit }); }
        else { if (["REJECT", "HUMAN_REVIEW_REQUIRED"].includes(result.payload.reviewState) || (result.payload.reviewState === "REVISE" && cycle.iteration === 3)) state.humanHold = true; issue(state, cycle, "ARCHITECT_FINAL_DECISION", now, { candidateCommit: cycle.candidateCommit, reviewedCommit: cycle.candidateCommit }); }
        break; }
      case "ARCHITECT_FINAL_DECISION": { if (result.payload.analystResultDigest !== cycle.analystResultDigest) throw new Error("ARCHITECT_DECISION_REVIEW_MISMATCH"); const latestReview = state.reviews.findLast((item) => item.cycleId === cycle.id); if (result.payload.decision === "ACCEPT" && !["PASS", "PASS_WITH_RECOMMENDATIONS"].includes(latestReview?.reviewState)) throw new Error("ARCHITECT_ACCEPT_WITHOUT_ANALYST_PASS"); if (result.payload.decision === "ACCEPT") { const analystTask = state.tasks.find((item) => item.taskId === latestReview?.id.replace(/^review:/u, "")); const analystResult = state.results.find((item) => item.taskId === analystTask?.taskId); if (!analystTask || !analystResult) throw new Error("ARCHITECT_ACCEPT_WITHOUT_VALIDATED_ANALYST_EVIDENCE"); validateRequiredValidationEvidence(state, analystTask, analystResult.result); } cycle.architectDecision = result.payload.decision; cycle.architectResultDigest = resultDigest;
        if (result.payload.decision === "ACCEPT") { cycle.status = "REVIEW"; cycle.stage = "AWAITING_INTEGRATION"; }
        else { const terminalStatus = result.payload.decision === "REJECT" ? "REJECTED" : result.payload.decision === "HUMAN_REVIEW" ? "ESCALATED" : "HALTED"; finalizeTerminalCycle(state, cycle, { status: terminalStatus, stage: "DISPOSITION", terminalReason: `ARCHITECT_${result.payload.decision}`, now }); }
        break; }
      default: throw new Error("UNSUPPORTED_TASK_PURPOSE");
    }
    state.stateVersion = acceptedVersion; return { state, value: storedReceipt };
  }});
}
