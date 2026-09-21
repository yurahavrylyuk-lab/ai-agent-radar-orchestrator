import fs from "node:fs";
import path from "node:path";
import { PHASE2, sha256Canonical } from "./contracts.mjs";
import { finalizeTerminalCycle, isRealTarget } from "./coordinator.mjs";
import { changedFiles, commitMetadata, currentBranch, git, resolveCommit, statusPorcelain, verifyPilotCandidate } from "./git-evidence.mjs";
import { acquireLock, mutateStateV2, readState } from "./local-store.mjs";
import { resolveRegisteredWorkspace } from "./workspaces.mjs";

function requireApproved(state, cycle) {
  if (cycle.architectDecision !== "ACCEPT" || !cycle.architectResultDigest) throw new Error("ARCHITECT_ACCEPT_REQUIRED");
  const review = state.reviews.findLast((item) => item.cycleId === cycle.id); if (!review || !["PASS", "PASS_WITH_RECOMMENDATIONS"].includes(review.reviewState) || review.resultDigest !== cycle.analystResultDigest || review.reviewedCommit !== cycle.candidateCommit) throw new Error("INDEPENDENT_ANALYST_PASS_REQUIRED");
  return review;
}

export function integrateFixtureCandidate({ statePath, ownerId, ownerGeneration, cycleId, targetRoot, now, fixture = false, inject = null }) {
  if (!fixture || isRealTarget(targetRoot) || PHASE2.realPilotActivation) throw Object.assign(new Error("REAL_PILOT_NOT_AUTHORIZED"), { code: "REAL_PILOT_NOT_AUTHORIZED" });
  const canonicalTarget = fs.realpathSync(targetRoot); const initial = readState(statePath); const cycle = initial.cycles.find((item) => item.id === cycleId); if (!cycle) throw new Error("CYCLE_NOT_FOUND");
  if (cycle.targetBranch !== PHASE2.pilotBranch) throw new Error("TARGET_BRANCH_NOT_AUTHORIZED");
  if (initial.integrationIntents.some((item) => item.cycleId === cycleId)) throw Object.assign(new Error("INTEGRATION_RECONCILIATION_REQUIRED"), { code: "INTEGRATION_RECONCILIATION_REQUIRED" });
  if (initial.humanHold) throw new Error("HUMAN_HOLD");
  if (canonicalTarget !== cycle.targetRoot) throw new Error("TARGET_IDENTITY_MISMATCH");
  const review = requireApproved(initial, cycle); const builderTask = [...initial.tasks].reverse().find((item) => item.cycleId === cycleId && item.role === "builder"); const workspaceRecord = initial.workspaces.find((item) => item.taskId === builderTask?.taskId); const workspaceRoot = resolveRegisteredWorkspace(workspaceRecord, "builder");
  const checkpoint = initial.checkpointReceipts.find((item) => item.taskId === builderTask.taskId); if (!checkpoint || checkpoint.candidateCommit !== cycle.candidateCommit) throw new Error("CHECKPOINT_RECEIPT_REQUIRED");
  const evidence = verifyPilotCandidate({ root: workspaceRoot, candidateCommit: cycle.candidateCommit, expectedParent: checkpoint.parentCommit, baselineCommit: cycle.baselineCommit, previousCandidate: cycle.iteration > 1 ? checkpoint.parentCommit : null });
  if (currentBranch(canonicalTarget) !== cycle.targetBranch || resolveCommit(canonicalTarget, `refs/heads/${cycle.targetBranch}`) !== cycle.expectedTargetTip || statusPorcelain(canonicalTarget) !== "") throw new Error("TARGET_PRECONDITION_FAILED");
  const mainBefore = resolveCommit(canonicalTarget, "refs/heads/main");
  const intent = { schemaVersion: 2, intentId: `integration:${cycle.id}`, repositoryId: initial.repositoryId, cycleId: cycle.id, targetRoot: canonicalTarget, targetBranch: cycle.targetBranch, oldTip: cycle.expectedTargetTip, newTip: cycle.candidateCommit, candidateTree: evidence.tree, scopeDigest: evidence.scopeDigest, approvalId: initial.approval.approvalId, reviewResultDigest: review.resultDigest, architectResultDigest: cycle.architectResultDigest, status: "PREPARED", createdAt: now };
  mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) { state.integrationIntents.push(intent); state.humanHold = true; state.stateVersion += 1; return { state }; } });
  if (inject === "after-intent") throw Object.assign(new Error("INTEGRATION_RECONCILIATION_REQUIRED"), { code: "INTEGRATION_RECONCILIATION_REQUIRED" });
  const gitDir = path.resolve(canonicalTarget, git(canonicalTarget, ["rev-parse", "--git-dir"]).stdout.trim()); const lock = acquireLock(path.join(gitDir, "gov002-integration.lock"), { controllerId: initial.controllerId, cycleId, pid: process.pid }); if (!lock.acquired) throw new Error("TARGET_EXCLUSIVE_WRITER_UNAVAILABLE");
  try {
    git(canonicalTarget, ["fetch", "--no-tags", workspaceRoot, cycle.candidateCommit], { write: true });
    const descendant = git(canonicalTarget, ["merge-base", "--is-ancestor", cycle.expectedTargetTip, cycle.candidateCommit], { allowFailure: true }); if (descendant.status !== 0) throw new Error("CANDIDATE_NOT_DESCENDANT");
    const cumulative = changedFiles(canonicalTarget, cycle.baselineCommit, cycle.candidateCommit); if (sha256Canonical(cumulative) !== intent.scopeDigest) throw new Error("INTEGRATION_SCOPE_MISMATCH");
    git(canonicalTarget, ["update-ref", `refs/heads/${cycle.targetBranch}`, cycle.candidateCommit, cycle.expectedTargetTip], { write: true });
    if (inject === "after-ref") throw new Error("INJECTED_INTEGRATION_UNCERTAINTY");
    git(canonicalTarget, ["read-tree", "--reset", "-u", cycle.candidateCommit], { write: true });
    if (resolveCommit(canonicalTarget, `refs/heads/${cycle.targetBranch}`) !== cycle.candidateCommit || resolveCommit(canonicalTarget, "HEAD") !== cycle.candidateCommit || resolveCommit(canonicalTarget, "refs/heads/main") !== mainBefore || statusPorcelain(canonicalTarget) !== "") throw new Error("INTEGRATION_POSTCONDITION_FAILED");
    const metadata = commitMetadata(canonicalTarget, cycle.candidateCommit); if (metadata.tree !== intent.candidateTree) throw new Error("INTEGRATED_COMMIT_IDENTITY_CHANGED");
    mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) {
      const stored = state.integrationIntents.find((item) => item.intentId === intent.intentId); stored.status = "APPLIED";
      state.integrationOutcomes.push({ intentId: intent.intentId, cycleId, status: "INTEGRATED", oldTip: intent.oldTip, newTip: intent.newTip, verifiedAt: now });
      const current = state.cycles.find((item) => item.id === cycleId); current.integrationStatus = "INTEGRATED";
      const finalSummary = finalizeTerminalCycle(state, current, { status: "ACCEPTED", stage: "COMPLETE", terminalReason: "INTEGRATED", now, humanHold: false, integration: { status: "INTEGRATED", oldTip: intent.oldTip, newTip: intent.newTip, scopeDigest: intent.scopeDigest } }); state.stateVersion += 1; return { state, value: finalSummary };
    }});
    return { status: "INTEGRATED", intent, candidateCommit: cycle.candidateCommit };
  } catch (error) {
    try { mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) { state.humanHold = true; const stored = state.integrationIntents.find((item) => item.intentId === intent.intentId); if (stored) stored.status = "RECONCILIATION_REQUIRED"; state.integrationOutcomes.push({ intentId: intent.intentId, cycleId, status: "INTEGRATION_RECONCILIATION_REQUIRED", observedTip: resolveCommit(canonicalTarget, `refs/heads/${cycle.targetBranch}`), observedAt: now }); state.stateVersion += 1; return { state }; } }); } catch { /* retain initial uncertainty */ }
    const uncertain = new Error("INTEGRATION_RECONCILIATION_REQUIRED", { cause: error }); uncertain.code = "INTEGRATION_RECONCILIATION_REQUIRED"; throw uncertain;
  } finally { lock.release(); }
}
