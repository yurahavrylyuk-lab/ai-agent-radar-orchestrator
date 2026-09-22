import fs from "node:fs";
import path from "node:path";
import { finalizeTerminalCycle } from "./coordinator.mjs";
import { verifyBoundControllerIdentity } from "./controller-identity.mjs";
import { changedFiles, commitMetadata, currentBranch, git, resolveCommit, statusPorcelain, verifyPilotCandidate } from "./git-evidence.mjs";
import { acquireLock, mutateStateV2, readState } from "./local-store.mjs";
import { assertAuthorityStoreBinding } from "./operator-boundary.mjs";
import { captureTargetSnapshot } from "./target-snapshot.mjs";
import { validateRequiredValidationEvidence } from "./validation-evidence.mjs";
import { validateAuthorityState } from "./validate.mjs";
import { resolveRegisteredWorkspace } from "./workspaces.mjs";

function requireApprovalEvidence(state, cycle) {
  if (cycle.architectDecision !== "ACCEPT" || !cycle.architectResultDigest) throw new Error("ARCHITECT_ACCEPT_REQUIRED");
  const review = state.reviews.findLast((item) => item.cycleId === cycle.id);
  if (!review || !["PASS", "PASS_WITH_RECOMMENDATIONS"].includes(review.reviewState) || review.resultDigest !== cycle.analystResultDigest || review.reviewedCommit !== cycle.candidateCommit) throw new Error("INDEPENDENT_ANALYST_PASS_REQUIRED");
  const task = state.tasks.find((item) => item.taskId === review.id.replace(/^review:/u, ""));
  const result = state.results.find((item) => item.taskId === task?.taskId);
  if (!task || !result) throw new Error("ANALYST_VALIDATION_EVIDENCE_REQUIRED");
  validateRequiredValidationEvidence(state, task, result.result);
  return { review, task, result };
}

function assertPreexistingPreserved(before, after, allowedPath) {
  const beforeFiles = new Map(before.manifest.map((item) => [item.path, item.sha256]));
  const beforeModes = new Map(before.modes.map((item) => [item.path, item.mode]));
  for (const item of after.manifest) {
    if (item.path === allowedPath) continue;
    if (beforeFiles.get(item.path) !== item.sha256 || beforeModes.get(item.path) !== after.modes.find((mode) => mode.path === item.path)?.mode) throw new Error("PREEXISTING_TARGET_CONTENT_CHANGED");
  }
  if (after.manifest.length !== before.manifest.length + 1 || !after.manifest.some((item) => item.path === allowedPath)) throw new Error("INTEGRATION_CHANGED_PATH_SET_INVALID");
}

function reconcile({ statePath, ownerId, ownerGeneration, intentId, cycleId, targetRoot, branch, now }) {
  try {
    mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) {
      state.humanHold = true;
      const intent = state.integrationIntents.find((item) => item.intentId === intentId); if (intent) intent.status = "RECONCILIATION_REQUIRED";
      const record = state.authorizations.find((item) => item.lifecycle.claimedCycleId === cycleId); if (record) { const from = record.lifecycle.status; record.lifecycle.status = "RECONCILIATION_REQUIRED"; record.lifecycle.transitionHistory.push({ from, to: "RECONCILIATION_REQUIRED", at: now, reason: "INTEGRATION_OUTCOME_UNCERTAIN" }); }
      if (!state.integrationOutcomes.some((item) => item.intentId === intentId)) state.integrationOutcomes.push({ intentId, cycleId, status: "INTEGRATION_RECONCILIATION_REQUIRED", observedTip: resolveCommit(targetRoot, `refs/heads/${branch}`), observedAt: now });
      state.stateVersion += 1; return { state };
    }});
  } catch { /* the durable intent remains the source of uncertainty */ }
}

export function integrateRealCandidate({ statePath, cycleId, controllerRoot = process.cwd(), now = new Date().toISOString(), inject = null }) {
  const initial = readState(statePath); validateAuthorityState(initial, statePath); assertAuthorityStoreBinding(statePath, initial.authorityStore);
  const cycle = initial.cycles.find((item) => item.id === cycleId); if (!cycle) throw new Error("CYCLE_NOT_FOUND");
  const authorization = initial.authorizations.find((item) => item.lifecycle.claimedCycleId === cycleId); if (!authorization) throw new Error("CLAIMED_AUTHORIZATION_REQUIRED");
  const { grant, lifecycle } = authorization;
  if (lifecycle.status === "CONSUMED") {
    const outcome = initial.integrationOutcomes.find((item) => item.cycleId === cycleId && item.status === "INTEGRATED");
    if (outcome) return { status: "IDEMPOTENT_REPLAY", candidateCommit: outcome.newTip, outcome: structuredClone(outcome) };
  }
  if (lifecycle.status !== "CLAIMED") throw new Error(lifecycle.status === "RECONCILIATION_REQUIRED" || lifecycle.status === "INTEGRATING" ? "INTEGRATION_RECONCILIATION_REQUIRED" : "AUTHORIZATION_NOT_INTEGRATION_ELIGIBLE");
  verifyBoundControllerIdentity(grant.controller, controllerRoot);
  const targetRoot = fs.realpathSync(grant.canonicalTargetRoot);
  const targetGitDirectory = fs.realpathSync(path.resolve(targetRoot, git(targetRoot, ["rev-parse", "--git-dir"]).stdout.trim())); const targetGitDirectoryStat = fs.lstatSync(targetGitDirectory); if (targetGitDirectory !== grant.targetSnapshot.gitDirectoryIdentity.canonicalPath || targetGitDirectoryStat.dev !== grant.targetSnapshot.gitDirectoryIdentity.device || targetGitDirectoryStat.ino !== grant.targetSnapshot.gitDirectoryIdentity.inode) throw new Error("TARGET_GIT_DIRECTORY_IDENTITY_MISMATCH");
  if (currentBranch(targetRoot) !== grant.targetBranch || resolveCommit(targetRoot, `refs/heads/${grant.targetBranch}`) !== grant.baselineCommit || statusPorcelain(targetRoot) !== "") throw new Error("TARGET_PRECONDITION_FAILED");
  if (resolveCommit(targetRoot, "refs/heads/main") !== grant.targetSnapshot.protectedRefs.main || resolveCommit(targetRoot, "refs/remotes/origin/main") !== grant.targetSnapshot.protectedRefs.originMain || resolveCommit(targetRoot, `refs/remotes/origin/${grant.targetBranch}`) !== grant.targetSnapshot.protectedRefs.originSelfImprovement) throw new Error("PROTECTED_REFS_CHANGED");
  if (fs.existsSync(path.join(targetRoot, grant.allowedChanges[0].path))) throw new Error("PILOT_PATH_ALREADY_EXISTS");
  const before = captureTargetSnapshot(targetRoot);
  if (before.manifestDigest !== grant.targetSnapshot.manifestDigest || before.modesDigest !== grant.targetSnapshot.modesDigest || before.configDigest !== grant.targetSnapshot.configDigest || before.indexDigest !== grant.targetSnapshot.indexDigest) throw new Error("TARGET_SNAPSHOT_MISMATCH");
  const approved = requireApprovalEvidence(initial, cycle);
  const builderTask = [...initial.tasks].reverse().find((item) => item.cycleId === cycleId && item.role === "builder");
  const workspace = initial.workspaces.find((item) => item.taskId === builderTask?.taskId); const workspaceRoot = resolveRegisteredWorkspace(workspace, "builder");
  const checkpoint = initial.checkpointReceipts.find((item) => item.taskId === builderTask.taskId); if (!checkpoint || checkpoint.candidateCommit !== cycle.candidateCommit) throw new Error("CHECKPOINT_RECEIPT_REQUIRED");
  const candidate = verifyPilotCandidate({ root: workspaceRoot, candidateCommit: cycle.candidateCommit, expectedParent: checkpoint.parentCommit, baselineCommit: grant.baselineCommit, previousCandidate: cycle.iteration > 1 ? checkpoint.parentCommit : null });
  if (inject === "before-intent") throw new Error("INJECTED_FAILURE_BEFORE_INTENT");
  const intentId = `real-integration:${grant.authorizationId}`;
  const intent = { schemaVersion: 3, intentId, authorizationId: grant.authorizationId, authorizationDigest: grant.authorizationDigest, repositoryId: grant.repositoryId, cycleId, targetRoot, targetBranch: grant.targetBranch, oldTip: grant.baselineCommit, newTip: cycle.candidateCommit, candidateTree: candidate.tree, scopeDigest: candidate.scopeDigest, reviewResultDigest: approved.review.resultDigest, architectResultDigest: cycle.architectResultDigest, status: "PREPARED", createdAt: now };
  mutateStateV2({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, mutator(state) {
    const record = state.authorizations.find((item) => item.grant.authorizationId === grant.authorizationId); if (record.lifecycle.status !== "CLAIMED") throw new Error("AUTHORIZATION_NOT_CLAIMED");
    state.integrationIntents.push(intent); state.humanHold = true; record.lifecycle.status = "INTEGRATING"; record.lifecycle.integrationIntentId = intentId; record.lifecycle.transitionHistory.push({ from: "CLAIMED", to: "INTEGRATING", at: now, reason: "DURABLE_INTEGRATION_INTENT" }); state.stateVersion += 1; return { state };
  }});
  if (inject === "after-intent") { reconcile({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, intentId, cycleId, targetRoot, branch: grant.targetBranch, now }); throw Object.assign(new Error("INTEGRATION_RECONCILIATION_REQUIRED"), { code: "INTEGRATION_RECONCILIATION_REQUIRED" }); }
  const gitDir = path.resolve(targetRoot, git(targetRoot, ["rev-parse", "--git-dir"]).stdout.trim());
  const lock = acquireLock(path.join(gitDir, "gov002-real-integration.lock"), { authorizationId: grant.authorizationId, cycleId, pid: process.pid });
  if (!lock.acquired) { reconcile({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, intentId, cycleId, targetRoot, branch: grant.targetBranch, now }); throw new Error("TARGET_EXCLUSIVE_WRITER_UNAVAILABLE"); }
  try {
    git(targetRoot, ["fetch", "--no-write-fetch-head", "--no-tags", workspaceRoot, cycle.candidateCommit], { write: true });
    const descendant = git(targetRoot, ["merge-base", "--is-ancestor", grant.baselineCommit, cycle.candidateCommit], { allowFailure: true }); if (descendant.status !== 0) throw new Error("CANDIDATE_NOT_DESCENDANT");
    const imported = changedFiles(targetRoot, grant.baselineCommit, cycle.candidateCommit); if (imported.length !== 1 || imported[0].path !== grant.allowedChanges[0].path || imported[0].status !== "A") throw new Error("INTEGRATION_SCOPE_MISMATCH");
    git(targetRoot, ["update-ref", `refs/heads/${grant.targetBranch}`, cycle.candidateCommit, grant.baselineCommit], { write: true });
    if (inject === "after-ref") throw new Error("INJECTED_AFTER_REF_MUTATION");
    git(targetRoot, ["read-tree", "--reset", "-u", cycle.candidateCommit], { write: true });
    if (inject === "after-worktree") throw new Error("INJECTED_AFTER_WORKTREE_MUTATION");
    const after = captureTargetSnapshot(targetRoot); assertPreexistingPreserved(before, after, grant.allowedChanges[0].path);
    if (resolveCommit(targetRoot) !== cycle.candidateCommit || resolveCommit(targetRoot, "refs/heads/main") !== grant.targetSnapshot.protectedRefs.main || resolveCommit(targetRoot, "refs/remotes/origin/main") !== grant.targetSnapshot.protectedRefs.originMain || resolveCommit(targetRoot, `refs/remotes/origin/${grant.targetBranch}`) !== grant.targetSnapshot.protectedRefs.originSelfImprovement || statusPorcelain(targetRoot) !== "") throw new Error("INTEGRATION_POSTCONDITION_FAILED");
    if (commitMetadata(targetRoot, cycle.candidateCommit).tree !== intent.candidateTree) throw new Error("INTEGRATED_COMMIT_IDENTITY_CHANGED");
    if (inject === "before-receipt") throw new Error("INJECTED_BEFORE_FINAL_RECEIPT");
    mutateStateV2({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, mutator(state) {
      const storedIntent = state.integrationIntents.find((item) => item.intentId === intentId); storedIntent.status = "APPLIED";
      const record = state.authorizations.find((item) => item.grant.authorizationId === grant.authorizationId); record.lifecycle.status = "CONSUMED"; record.lifecycle.integratedCommit = cycle.candidateCommit; record.lifecycle.transitionHistory.push({ from: "INTEGRATING", to: "CONSUMED", at: now, reason: "VERIFIED_IDENTITY_PRESERVING_INTEGRATION" });
      state.integrationOutcomes.push({ intentId, cycleId, status: "INTEGRATED", oldTip: grant.baselineCommit, newTip: cycle.candidateCommit, verifiedAt: now });
      const current = state.cycles.find((item) => item.id === cycleId); current.integrationStatus = "INTEGRATED";
      const summary = finalizeTerminalCycle(state, current, { status: "ACCEPTED", stage: "COMPLETE", terminalReason: "INTEGRATED", now, humanHold: false, integration: { status: "INTEGRATED", oldTip: grant.baselineCommit, newTip: cycle.candidateCommit, scopeDigest: candidate.scopeDigest } });
      state.stateVersion += 1; return { state, value: summary };
    }});
    return { status: "INTEGRATED", authorizationId: grant.authorizationId, candidateCommit: cycle.candidateCommit, intentId };
  } catch (error) {
    reconcile({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, intentId, cycleId, targetRoot, branch: grant.targetBranch, now });
    const uncertain = new Error("INTEGRATION_RECONCILIATION_REQUIRED", { cause: error }); uncertain.code = "INTEGRATION_RECONCILIATION_REQUIRED"; throw uncertain;
  } finally { lock.release(); }
}
