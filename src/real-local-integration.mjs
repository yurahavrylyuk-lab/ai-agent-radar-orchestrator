import fs from "node:fs";
import path from "node:path";
import { finalizeTerminalCycle } from "./coordinator.mjs";
import { sha256Canonical } from "./contracts.mjs";
import { verifyBoundControllerIdentity } from "./controller-identity.mjs";
import { changedFiles, commitMetadata, currentBranch, git, resolveCommit, statusPorcelain, verifyPilotCandidate } from "./git-evidence.mjs";
import { acquireLock, mutateStateV2, readState } from "./local-store.mjs";
import { assertTrustedAuthoritySource } from "./operator-boundary.mjs";
import { assertSemanticIndexInvariant, captureTargetSnapshot } from "./target-snapshot.mjs";
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

function requireIntegrationEligibility(state, cycleId, expected = null) {
  if (state.humanHold) throw new Error("HUMAN_HOLD_ACTIVE");
  if (state.activeCycleId !== cycleId) throw new Error("ACTIVE_CYCLE_MISMATCH");
  if (state.checkpointIntents.some((item) => item.status !== "COMPLETED")) throw new Error("CHECKPOINT_RECONCILIATION_ACTIVE");
  if (state.integrationIntents.some((item) => !["APPLIED", "CLOSED"].includes(item.status))) throw new Error("INTEGRATION_RECONCILIATION_REQUIRED");
  const cycle = state.cycles.find((item) => item.id === cycleId); if (!cycle) throw new Error("CYCLE_NOT_FOUND");
  if (cycle.status !== "REVIEW" || cycle.stage !== "AWAITING_INTEGRATION" || cycle.integrationStatus !== "NOT_STARTED") throw new Error("CYCLE_NOT_INTEGRATION_READY");
  const authorization = state.authorizations.find((item) => item.lifecycle.claimedCycleId === cycleId); if (!authorization) throw new Error("CLAIMED_AUTHORIZATION_REQUIRED");
  const { grant, lifecycle } = authorization;
  if (lifecycle.status !== "CLAIMED" || lifecycle.claimedCycleId !== cycleId || lifecycle.claimedRequestId !== grant.requestId || lifecycle.integrationIntentId !== null) throw new Error("AUTHORIZATION_NOT_INTEGRATION_ELIGIBLE");
  if (cycle.requestId !== grant.requestId || cycle.targetRoot !== grant.canonicalTargetRoot || cycle.targetBranch !== grant.targetBranch || cycle.baselineCommit !== grant.baselineCommit) throw new Error("CYCLE_AUTHORIZATION_MISMATCH");
  const approved = requireApprovalEvidence(state, cycle);
  if (expected !== null && (grant.authorizationId !== expected.authorizationId || grant.authorizationDigest !== expected.authorizationDigest || cycle.candidateCommit !== expected.candidateCommit || approved.review.resultDigest !== expected.reviewResultDigest || cycle.architectResultDigest !== expected.architectResultDigest)) throw new Error("INTEGRATION_ELIGIBILITY_CHANGED");
  return { cycle, authorization, grant, lifecycle, approved };
}

function verifyTargetPreconditions(grant) {
  const targetRoot = fs.realpathSync(grant.canonicalTargetRoot);
  const targetGitDirectory = fs.realpathSync(path.resolve(targetRoot, git(targetRoot, ["rev-parse", "--git-dir"]).stdout.trim())); const targetGitDirectoryStat = fs.lstatSync(targetGitDirectory); if (targetGitDirectory !== grant.targetSnapshot.gitDirectoryIdentity.canonicalPath || targetGitDirectoryStat.dev !== grant.targetSnapshot.gitDirectoryIdentity.device || targetGitDirectoryStat.ino !== grant.targetSnapshot.gitDirectoryIdentity.inode) throw new Error("TARGET_GIT_DIRECTORY_IDENTITY_MISMATCH");
  if (currentBranch(targetRoot) !== grant.targetBranch || resolveCommit(targetRoot, `refs/heads/${grant.targetBranch}`) !== grant.baselineCommit) throw new Error("TARGET_PRECONDITION_FAILED");
  if (resolveCommit(targetRoot, "refs/heads/main") !== grant.targetSnapshot.protectedRefs.main || resolveCommit(targetRoot, "refs/remotes/origin/main") !== grant.targetSnapshot.protectedRefs.originMain || resolveCommit(targetRoot, `refs/remotes/origin/${grant.targetBranch}`) !== grant.targetSnapshot.protectedRefs.originSelfImprovement) throw new Error("PROTECTED_REFS_CHANGED");
  if (fs.existsSync(path.join(targetRoot, grant.allowedChanges[0].path))) throw new Error("PILOT_PATH_ALREADY_EXISTS");
  const before = captureTargetSnapshot(targetRoot);
  assertSemanticIndexInvariant(before);
  if (statusPorcelain(targetRoot) !== "") throw new Error("TARGET_PRECONDITION_FAILED");
  if (before.manifestDigest !== grant.targetSnapshot.manifestDigest || before.modesDigest !== grant.targetSnapshot.modesDigest || before.configDigest !== grant.targetSnapshot.configDigest || before.semanticIndex.format !== grant.targetSnapshot.semanticIndex.format || before.semanticIndex.digest !== grant.targetSnapshot.semanticIndex.digest || before.semanticIndex.entryCount !== grant.targetSnapshot.semanticIndex.entryCount) throw new Error("TARGET_SNAPSHOT_MISMATCH");
  return { targetRoot, before };
}

function checkoutEvidence(snapshot, pilotPathAbsent) {
  return {
    head: snapshot.head,
    symbolicHead: snapshot.symbolicHead,
    semanticIndex: structuredClone(snapshot.semanticIndex),
    manifestDigest: snapshot.manifestDigest,
    modesDigest: snapshot.modesDigest,
    configDigest: snapshot.configDigest,
    gitDirectoryIdentity: structuredClone(snapshot.gitDirectoryIdentity),
    statusDigest: snapshot.statusDigest,
    statusPorcelainV1Base64: snapshot.statusPorcelainV1Base64,
    fileCount: snapshot.manifest.length,
    pilotPathAbsent,
  };
}

function refsByName(snapshot) {
  return new Map(snapshot.refs.trim().split("\n").filter(Boolean).map((line) => { const separator = line.lastIndexOf(" "); return [line.slice(0, separator), line.slice(separator + 1)]; }));
}

function assertRefOnlyCheckoutPreserved({ before, after, grant, candidate, intent }) {
  const updatedRef = `refs/heads/${grant.targetBranch}`;
  const beforeRefs = refsByName(before); const afterRefs = refsByName(after);
  if (beforeRefs.size !== afterRefs.size) throw new Error("UNEXPECTED_REF_SET_CHANGE");
  for (const [name, oid] of beforeRefs) if (afterRefs.get(name) !== (name === updatedRef ? intent.newTip : oid)) throw new Error("UNEXPECTED_REF_CHANGE");
  if (before.head !== intent.oldTip || after.head !== intent.newTip || before.symbolicHead !== updatedRef || after.symbolicHead !== updatedRef) throw new Error("REF_ONLY_HEAD_IDENTITY_MISMATCH");
  if (after.semanticIndex.format !== before.semanticIndex.format || after.semanticIndex.digest !== before.semanticIndex.digest || after.semanticIndex.entryCount !== before.semanticIndex.entryCount) throw new Error("PRESERVED_INDEX_SEMANTICS_CHANGED");
  if (after.semanticIndex.equalsHeadTree || !after.semanticIndex.ordinaryFlagsOnly || after.semanticIndex.cachedDiffEmpty) throw new Error("EXPECTED_UNSYNCHRONIZED_INDEX_STATE_MISSING");
  if (after.manifestDigest !== before.manifestDigest || after.modesDigest !== before.modesDigest || after.configDigest !== before.configDigest || after.manifest.length !== before.manifest.length) throw new Error("PRESERVED_CHECKOUT_CHANGED");
  if (JSON.stringify(after.gitDirectoryIdentity) !== JSON.stringify(before.gitDirectoryIdentity)) throw new Error("TARGET_GIT_DIRECTORY_IDENTITY_MISMATCH");
  if (fs.existsSync(path.join(grant.canonicalTargetRoot, grant.allowedChanges[0].path))) throw new Error("PILOT_PATH_UNEXPECTEDLY_SYNCHRONIZED");
  const expectedStatus = Buffer.from(`D  ${grant.allowedChanges[0].path}\0`, "utf8").toString("base64");
  if (after.statusPorcelainV1Base64 !== expectedStatus) throw new Error("UNSYNCHRONIZED_CHECKOUT_STATUS_MISMATCH");
  if (commitMetadata(grant.canonicalTargetRoot, intent.newTip).tree !== intent.candidateTree || candidate.tree !== intent.candidateTree || candidate.scopeDigest !== intent.scopeDigest) throw new Error("INTEGRATED_COMMIT_IDENTITY_CHANGED");
  return {
    schemaVersion: 1,
    status: "REF_ADVANCED_CHECKOUT_PRESERVED",
    synchronizedToNewHead: false,
    destructiveCheckoutPerformed: false,
    synchronizationRequirement: "SEPARATE_HUMAN_CONTROLLED_ACTION_REQUIRED",
    preIntegration: checkoutEvidence(before, true),
    integratedBranch: { targetBranch: grant.targetBranch, symbolicHead: updatedRef, updatedRef, expectedOldTip: intent.oldTip, newTip: intent.newTip, candidateTree: intent.candidateTree, scopeDigest: intent.scopeDigest, reviewResultDigest: intent.reviewResultDigest, architectResultDigest: intent.architectResultDigest },
    postIntegration: checkoutEvidence(after, true),
  };
}

function reconcile({ statePath, ownerId, ownerGeneration, intentId, cycleId, targetRoot, branch, now }) {
  const initial = readState(statePath); validateAuthorityState(initial, statePath); assertTrustedAuthoritySource({ statePath, targetRoot, stored: initial.authorityStore });
  try {
    mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) {
      assertTrustedAuthoritySource({ statePath, targetRoot, stored: state.authorityStore });
      state.humanHold = true;
      const intent = state.integrationIntents.find((item) => item.intentId === intentId); if (intent) intent.status = "RECONCILIATION_REQUIRED";
      const record = state.authorizations.find((item) => item.lifecycle.claimedCycleId === cycleId); if (record) { const from = record.lifecycle.status; record.lifecycle.status = "RECONCILIATION_REQUIRED"; record.lifecycle.transitionHistory.push({ from, to: "RECONCILIATION_REQUIRED", at: now, reason: "INTEGRATION_OUTCOME_UNCERTAIN" }); }
      if (!state.integrationOutcomes.some((item) => item.intentId === intentId)) state.integrationOutcomes.push({ intentId, cycleId, status: "INTEGRATION_RECONCILIATION_REQUIRED", observedTip: resolveCommit(targetRoot, `refs/heads/${branch}`), observedAt: now });
      state.stateVersion += 1; return { state };
    }});
  } catch { /* the durable intent remains the source of uncertainty */ }
}

export function integrateRealCandidate({ statePath, cycleId, controllerRoot = process.cwd(), now = new Date().toISOString(), inject = null, testBeforeLockedRecheck = null, testBeforeRefRecheck = null }) {
  const initial = readState(statePath);
  const cycleRecord = initial.cycles.find((item) => item.id === cycleId); if (!cycleRecord) throw new Error("CYCLE_NOT_FOUND");
  const authorizationRecord = initial.authorizations.find((item) => item.lifecycle.claimedCycleId === cycleId); if (!authorizationRecord) throw new Error("CLAIMED_AUTHORIZATION_REQUIRED");
  const authority = assertTrustedAuthoritySource({ statePath, targetRoot: cycleRecord.targetRoot, stored: initial.authorityStore });
  assertTrustedAuthoritySource({ statePath, targetRoot: authorizationRecord.grant.canonicalTargetRoot, stored: initial.authorityStore });
  validateAuthorityState(initial, statePath);
  const { grant, lifecycle } = authorizationRecord;
  if (lifecycle.status === "CONSUMED") {
    const outcome = initial.integrationOutcomes.find((item) => item.cycleId === cycleId && item.status === "INTEGRATED");
    if (outcome) return { status: "IDEMPOTENT_REPLAY", candidateCommit: outcome.newTip, outcome: structuredClone(outcome) };
  }
  if (lifecycle.status !== "CLAIMED") throw new Error(lifecycle.status === "RECONCILIATION_REQUIRED" || lifecycle.status === "INTEGRATING" ? "INTEGRATION_RECONCILIATION_REQUIRED" : "AUTHORIZATION_NOT_INTEGRATION_ELIGIBLE");
  const eligible = requireIntegrationEligibility(initial, cycleId);
  const { cycle, approved } = eligible;
  verifyBoundControllerIdentity(grant.controller, controllerRoot);
  const { targetRoot, before } = verifyTargetPreconditions(grant);
  const builderTask = [...initial.tasks].reverse().find((item) => item.cycleId === cycleId && item.role === "builder");
  const workspace = initial.workspaces.find((item) => item.taskId === builderTask?.taskId); const workspaceRoot = resolveRegisteredWorkspace(workspace, "builder");
  const checkpoint = initial.checkpointReceipts.find((item) => item.taskId === builderTask.taskId); if (!checkpoint || checkpoint.candidateCommit !== cycle.candidateCommit) throw new Error("CHECKPOINT_RECEIPT_REQUIRED");
  const candidate = verifyPilotCandidate({ root: workspaceRoot, candidateCommit: cycle.candidateCommit, expectedParent: checkpoint.parentCommit, baselineCommit: grant.baselineCommit, previousCandidate: cycle.iteration > 1 ? checkpoint.parentCommit : null });
  if (inject === "before-intent") throw new Error("INJECTED_FAILURE_BEFORE_INTENT");
  if (testBeforeLockedRecheck !== null) {
    if (authority.authorityClass !== "DISPOSABLE_TEST" || typeof testBeforeLockedRecheck !== "function") throw new Error("TEST_HOOK_FORBIDDEN");
    testBeforeLockedRecheck();
  }
  const intentId = `real-integration:${grant.authorizationId}`;
  const intent = { schemaVersion: 4, intentId, authorizationId: grant.authorizationId, authorizationDigest: grant.authorizationDigest, repositoryId: grant.repositoryId, cycleId, targetRoot, targetBranch: grant.targetBranch, oldTip: grant.baselineCommit, newTip: cycle.candidateCommit, candidateTree: candidate.tree, scopeDigest: candidate.scopeDigest, reviewResultDigest: approved.review.resultDigest, architectResultDigest: cycle.architectResultDigest, checkoutBaseline: checkoutEvidence(before, true), status: "PREPARED", createdAt: now };
  mutateStateV2({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, mutator(state) {
    validateAuthorityState(state, statePath);
    assertTrustedAuthoritySource({ statePath, targetRoot: cycle.targetRoot, stored: state.authorityStore });
    const locked = requireIntegrationEligibility(state, cycleId, { authorizationId: grant.authorizationId, authorizationDigest: grant.authorizationDigest, candidateCommit: cycle.candidateCommit, reviewResultDigest: approved.review.resultDigest, architectResultDigest: cycle.architectResultDigest });
    assertTrustedAuthoritySource({ statePath, targetRoot: locked.grant.canonicalTargetRoot, stored: state.authorityStore });
    verifyTargetPreconditions(locked.grant);
    const record = locked.authorization;
    state.integrationIntents.push(intent); record.lifecycle.status = "INTEGRATING"; record.lifecycle.integrationIntentId = intentId; record.lifecycle.transitionHistory.push({ from: "CLAIMED", to: "INTEGRATING", at: now, reason: "DURABLE_REF_ONLY_INTEGRATION_INTENT" }); state.stateVersion += 1; return { state };
  }});
  if (inject === "after-intent") { reconcile({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, intentId, cycleId, targetRoot, branch: grant.targetBranch, now }); throw Object.assign(new Error("INTEGRATION_RECONCILIATION_REQUIRED"), { code: "INTEGRATION_RECONCILIATION_REQUIRED" }); }
  const gitDir = path.resolve(targetRoot, git(targetRoot, ["rev-parse", "--git-dir"]).stdout.trim());
  const lock = acquireLock(path.join(gitDir, "gov002-real-integration.lock"), { authorizationId: grant.authorizationId, cycleId, pid: process.pid });
  if (!lock.acquired) { reconcile({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, intentId, cycleId, targetRoot, branch: grant.targetBranch, now }); throw new Error("TARGET_EXCLUSIVE_WRITER_UNAVAILABLE"); }
  try {
    git(targetRoot, ["fetch", "--no-write-fetch-head", "--no-tags", workspaceRoot, cycle.candidateCommit], { write: true });
    const descendant = git(targetRoot, ["merge-base", "--is-ancestor", grant.baselineCommit, cycle.candidateCommit], { allowFailure: true }); if (descendant.status !== 0) throw new Error("CANDIDATE_NOT_DESCENDANT");
    const imported = changedFiles(targetRoot, grant.baselineCommit, cycle.candidateCommit); if (imported.length !== 1 || imported[0].path !== grant.allowedChanges[0].path || imported[0].status !== "A") throw new Error("INTEGRATION_SCOPE_MISMATCH");
    if (testBeforeRefRecheck !== null) {
      if (authority.authorityClass !== "DISPOSABLE_TEST" || typeof testBeforeRefRecheck !== "function") throw new Error("TEST_HOOK_FORBIDDEN");
      testBeforeRefRecheck({ targetRoot });
    }
    const stateLock = acquireLock(`${statePath}.lock`, { controllerId: initial.owner.id, generation: initial.owner.generation, operation: "ref-only-integration", pid: process.pid });
    if (!stateLock.acquired) throw new Error("STATE_LOCKED");
    try {
      const authoritative = readState(statePath); validateAuthorityState(authoritative, statePath);
      assertTrustedAuthoritySource({ statePath, targetRoot, stored: authoritative.authorityStore });
      if (authoritative.humanHold) throw new Error("HUMAN_HOLD_ACTIVE");
      const lockedCycle = authoritative.cycles.find((item) => item.id === cycleId); const lockedAuthorization = authoritative.authorizations.find((item) => item.grant.authorizationId === grant.authorizationId); const lockedIntent = authoritative.integrationIntents.find((item) => item.intentId === intentId);
      if (!lockedCycle || !lockedAuthorization || !lockedIntent || lockedAuthorization.lifecycle.status !== "INTEGRATING" || lockedAuthorization.lifecycle.integrationIntentId !== intentId || lockedIntent.status !== "PREPARED") throw new Error("INTEGRATION_ELIGIBILITY_CHANGED");
      if (sha256Canonical(lockedIntent) !== sha256Canonical(intent) || lockedAuthorization.grant.authorizationDigest !== grant.authorizationDigest) throw new Error("INTEGRATION_ELIGIBILITY_CHANGED");
      if (lockedCycle.status !== "REVIEW" || lockedCycle.stage !== "AWAITING_INTEGRATION" || lockedCycle.integrationStatus !== "NOT_STARTED" || lockedCycle.candidateCommit !== cycle.candidateCommit || lockedCycle.analystResultDigest !== cycle.analystResultDigest || lockedCycle.architectResultDigest !== cycle.architectResultDigest) throw new Error("INTEGRATION_ELIGIBILITY_CHANGED");
      requireApprovalEvidence(authoritative, lockedCycle);
      verifyBoundControllerIdentity(lockedAuthorization.grant.controller, controllerRoot);
      verifyTargetPreconditions(lockedAuthorization.grant);
      git(targetRoot, ["update-ref", `refs/heads/${grant.targetBranch}`, cycle.candidateCommit, grant.baselineCommit], { write: true });
    } finally { stateLock.release(); }
    if (inject === "after-ref") throw new Error("INJECTED_AFTER_REF_MUTATION");
    const after = captureTargetSnapshot(targetRoot); assertRefOnlyCheckoutPreserved({ before, after, grant, candidate, intent });
    if (inject === "before-receipt") throw new Error("INJECTED_BEFORE_FINAL_RECEIPT");
    const recorded = mutateStateV2({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, mutator(state) {
      validateAuthorityState(state, statePath);
      assertTrustedAuthoritySource({ statePath, targetRoot, stored: state.authorityStore });
      if (state.humanHold) throw new Error("HUMAN_HOLD_ACTIVE");
      const storedIntent = state.integrationIntents.find((item) => item.intentId === intentId); const record = state.authorizations.find((item) => item.grant.authorizationId === grant.authorizationId);
      if (!storedIntent || storedIntent.status !== "PREPARED" || !record || record.lifecycle.status !== "INTEGRATING" || record.lifecycle.integrationIntentId !== intentId) throw new Error("INTEGRATION_ELIGIBILITY_CHANGED");
      if (sha256Canonical(storedIntent) !== sha256Canonical(intent) || record.grant.authorizationDigest !== grant.authorizationDigest) throw new Error("INTEGRATION_ELIGIBILITY_CHANGED");
      const current = state.cycles.find((item) => item.id === cycleId); const currentApproval = requireApprovalEvidence(state, current); if (current.candidateCommit !== cycle.candidateCommit || currentApproval.review.resultDigest !== approved.review.resultDigest || current.architectResultDigest !== cycle.architectResultDigest) throw new Error("INTEGRATION_ELIGIBILITY_CHANGED");
      const checkoutCondition = assertRefOnlyCheckoutPreserved({ before, after: captureTargetSnapshot(targetRoot), grant, candidate, intent });
      storedIntent.status = "APPLIED";
      record.lifecycle.status = "CONSUMED"; record.lifecycle.integratedCommit = cycle.candidateCommit; record.lifecycle.transitionHistory.push({ from: "INTEGRATING", to: "CONSUMED", at: now, reason: "VERIFIED_REF_ONLY_INTEGRATION_WITH_PRESERVED_CHECKOUT" });
      state.integrationOutcomes.push({ intentId, cycleId, status: "INTEGRATED", oldTip: grant.baselineCommit, newTip: cycle.candidateCommit, checkoutCondition, verifiedAt: now });
      current.integrationStatus = "INTEGRATED";
      const summary = finalizeTerminalCycle(state, current, { status: "ACCEPTED", stage: "COMPLETE", terminalReason: "INTEGRATED", now, humanHold: false, integration: { status: "INTEGRATED", oldTip: grant.baselineCommit, newTip: cycle.candidateCommit, scopeDigest: candidate.scopeDigest }, checkoutCondition });
      state.stateVersion += 1; return { state, value: { summary, checkoutCondition } };
    }});
    return { status: "INTEGRATED", authorizationId: grant.authorizationId, candidateCommit: cycle.candidateCommit, intentId, checkoutCondition: recorded.value.checkoutCondition };
  } catch (error) {
    reconcile({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, intentId, cycleId, targetRoot, branch: grant.targetBranch, now });
    const uncertain = new Error("INTEGRATION_RECONCILIATION_REQUIRED", { cause: error }); uncertain.code = "INTEGRATION_RECONCILIATION_REQUIRED"; throw uncertain;
  } finally { lock.release(); }
}
