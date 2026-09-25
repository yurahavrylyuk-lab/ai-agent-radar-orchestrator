import fs from "node:fs";
import path from "node:path";
import { buildTask } from "./coordinator.mjs";
import { verifyBoundControllerIdentity } from "./controller-identity.mjs";
import { git, resolveCommit, statusPorcelain } from "./git-evidence.mjs";
import { mutateStateV2, readState } from "./local-store.mjs";
import { assertTrustedAuthoritySource } from "./operator-boundary.mjs";
import { assertSemanticIndexInvariant, captureTargetSnapshot } from "./target-snapshot.mjs";
import { sha256Canonical } from "./contracts.mjs";
import { validateAuthorityState, validatePilotRequest } from "./validate.mjs";

function sameSnapshot(grant, snapshot) {
  const expected = grant.targetSnapshot;
  assertSemanticIndexInvariant(snapshot);
  return expected.manifestDigest === snapshot.manifestDigest && expected.modesDigest === snapshot.modesDigest && expected.configDigest === snapshot.configDigest && expected.semanticIndex.format === snapshot.semanticIndex.format && expected.semanticIndex.digest === snapshot.semanticIndex.digest && expected.semanticIndex.entryCount === snapshot.semanticIndex.entryCount && snapshot.semanticIndex.equalsHeadTree && snapshot.semanticIndex.ordinaryFlagsOnly && snapshot.semanticIndex.cachedDiffEmpty && expected.fileCount === snapshot.manifest.length;
}

function assertSafePilotAncestors(root, relative) {
  let current = root;
  for (const segment of relative.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("UNSAFE_PILOT_PATH_ANCESTOR");
  }
}

function verifyTarget(grant) {
  const root = fs.realpathSync(grant.canonicalTargetRoot);
  if (root !== grant.canonicalTargetRoot) throw new Error("TARGET_ROOT_SUBSTITUTED");
  const gitDirectory = fs.realpathSync(path.resolve(root, git(root, ["rev-parse", "--git-dir"]).stdout.trim()));
  if (!gitDirectory.startsWith(`${root}${path.sep}`)) throw new Error("TARGET_GIT_DIRECTORY_IDENTITY_MISMATCH");
  const gitDirectoryStat = fs.lstatSync(gitDirectory); const expectedGitDirectory = grant.targetSnapshot.gitDirectoryIdentity;
  if (gitDirectory !== expectedGitDirectory.canonicalPath || gitDirectoryStat.dev !== expectedGitDirectory.device || gitDirectoryStat.ino !== expectedGitDirectory.inode) throw new Error("TARGET_GIT_DIRECTORY_IDENTITY_MISMATCH");
  if (git(root, ["branch", "--show-current"]).stdout.trim() !== grant.targetBranch) throw new Error("TARGET_BRANCH_MISMATCH");
  if (resolveCommit(root) !== grant.baselineCommit || resolveCommit(root, `refs/heads/${grant.targetBranch}`) !== grant.baselineCommit || resolveCommit(root, `refs/remotes/origin/${grant.targetBranch}`) !== grant.baselineCommit) throw new Error("TARGET_BASELINE_MISMATCH");
  if (resolveCommit(root, "refs/heads/main") !== grant.targetSnapshot.protectedRefs.main || resolveCommit(root, "refs/remotes/origin/main") !== grant.targetSnapshot.protectedRefs.originMain) throw new Error("TARGET_PRODUCTION_REFS_CHANGED");
  const approvedPath = grant.allowedChanges[0].path;
  if (fs.existsSync(path.join(root, approvedPath))) throw new Error("PILOT_PATH_ALREADY_EXISTS");
  assertSafePilotAncestors(root, approvedPath);
  if (statusPorcelain(root) !== "") throw new Error("TARGET_NOT_CLEAN");
  const snapshot = captureTargetSnapshot(root);
  if (!sameSnapshot(grant, snapshot)) throw new Error("TARGET_SNAPSHOT_MISMATCH");
  return snapshot;
}

export function admitRealPilotRequest({ statePath, request, controllerRoot = process.cwd(), now = new Date().toISOString() }) {
  validatePilotRequest(request);
  assertTrustedAuthoritySource({ statePath, targetRoot: request.targetRoot });
  const initial = readState(statePath);
  validateAuthorityState(initial, statePath);
  assertTrustedAuthoritySource({ statePath, targetRoot: request.targetRoot, stored: initial.authorityStore });
  const authorization = initial.authorizations.find((item) => item.grant.requestId === request.requestId);
  if (!authorization) throw new Error("MATCHING_AUTHORIZATION_REQUIRED");
  const { grant, lifecycle } = authorization;
  if (sha256Canonical(request) !== grant.requestDigest || request.repositoryId !== grant.repositoryId || fs.realpathSync(request.targetRoot) !== grant.canonicalTargetRoot || request.targetBranch !== grant.targetBranch || request.baselineCommit !== grant.baselineCommit || request.evidenceMode !== grant.evidenceMode) throw new Error("REQUEST_AUTHORIZATION_MISMATCH");
  verifyBoundControllerIdentity(grant.controller, controllerRoot);
  verifyTarget(grant);
  if (lifecycle.status !== "ISSUED") {
    const existing = initial.admissionReceipts.find((item) => item.authorizationId === grant.authorizationId && item.requestDigest === grant.requestDigest);
    if (lifecycle.status === "CLAIMED" && existing) return { status: "IDEMPOTENT_REPLAY", receipt: structuredClone(existing), task: structuredClone(initial.tasks.find((item) => item.taskId === existing.taskId)) };
    throw new Error("AUTHORIZATION_ALREADY_USED");
  }
  if (initial.humanHold || initial.activeCycleId !== null || initial.checkpointIntents.some((item) => item.status !== "COMPLETED") || initial.integrationIntents.some((item) => !["APPLIED", "CLOSED"].includes(item.status))) throw new Error("CONTROLLER_NOT_AVAILABLE");
  return mutateStateV2({ statePath, ownerId: initial.owner.id, ownerGeneration: initial.owner.generation, mutator(state) {
    const record = state.authorizations.find((item) => item.grant.authorizationId === grant.authorizationId);
    assertTrustedAuthoritySource({ statePath, targetRoot: request.targetRoot, stored: state.authorityStore });
    if (record.lifecycle.status !== "ISSUED") throw new Error("AUTHORIZATION_ALREADY_USED");
    const cycle = { id: grant.cycleId, requestId: request.requestId, status: "AWAITING_HUMAN_ROLE", stage: "ARCHITECT_PLAN", targetRoot: grant.canonicalTargetRoot, targetBranch: grant.targetBranch, baselineCommit: grant.baselineCommit, expectedTargetTip: grant.baselineCommit, iterationBaseCommit: grant.baselineCommit, iteration: 1, planRevision: 1, candidateCommit: null, analystResultDigest: null, architectDecision: null, integrationStatus: "NOT_STARTED", createdAt: now };
    const task = buildTask(state, cycle, "ARCHITECT_PLAN", now);
    const receipt = { receiptId: `admission:${grant.authorizationId}`, authorizationId: grant.authorizationId, authorizationDigest: grant.authorizationDigest, requestId: request.requestId, requestDigest: grant.requestDigest, cycleId: cycle.id, taskId: task.taskId, claimedAt: now };
    record.lifecycle.status = "CLAIMED"; record.lifecycle.claimedRequestId = request.requestId; record.lifecycle.claimedCycleId = cycle.id; record.lifecycle.transitionHistory.push({ from: "ISSUED", to: "CLAIMED", at: now, reason: "ATOMIC_REAL_PILOT_ADMISSION" });
    state.activeCycleId = cycle.id; state.cycles.push(cycle); state.tasks.push(task); state.pendingTaskId = task.taskId; state.admissionReceipts.push(receipt); state.stateVersion += 1;
    return { state, value: { status: "ADMITTED", receipt, task } };
  }}).value;
}
