import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, readState, replaceStateAtomic } from "./local-store.mjs";
import { PHASE2, parseJsonStrict, sha256Canonical } from "./contracts.mjs";
import { controllerReleaseIdentity, executeBoundRole, initializeExecutionJournal, reconcileExecutionJournal } from "./role-execution.mjs";
import { OfflineFixtureTransport, OFFLINE_FIXTURE_ADAPTER_VERSION, OFFLINE_FIXTURE_DIGEST, OFFLINE_FIXTURE_SCENARIOS } from "./adapters/offline-fixture.mjs";
import { enqueueRequest, initializeController, isRealTarget, preparePendingWorkspace } from "./coordinator.mjs";
import { git } from "./git-evidence.mjs";
import { createIntegrationPreparation } from "./integration-preparation.mjs";

export const OFFLINE_EXECUTION_POLICY = Object.freeze({ version: "offline-autopilot-policy-r1", evidenceMode: "OFFLINE_FIXTURE", network: false, providers: false, publication: false, deployment: false, scheduling: false, paidExecution: false, maxRoleExecutionSeconds: 900, maxCycleExecutionSeconds: 5400, maxIterations: 3, stopAt: "INTEGRATION_PREPARATION" });
export const OFFLINE_EXECUTION_POLICY_DIGEST = sha256Canonical(OFFLINE_EXECUTION_POLICY);

const RUNTIME_IDENTITY_FILE = ".offline-autopilot-runtime.json";
function identity(filePath) {
  const stat = fs.lstatSync(filePath);
  return Object.freeze({ canonicalPath: fs.realpathSync(filePath), type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "other", device: stat.dev, inode: stat.ino, owner: stat.uid, mode: stat.mode & 0o7777 });
}
function sameIdentity(left, right) { return left.canonicalPath === right.canonicalPath && left.type === right.type && left.device === right.device && left.inode === right.inode && left.owner === right.owner && left.mode === right.mode; }
function allowedTemporaryRoots() { return [...new Set([fs.realpathSync(os.tmpdir()), fs.realpathSync("/private/tmp")])]; }
function allowedRuntimeParent(runtimeRoot, explicitParent) {
  const requested = path.resolve(runtimeRoot); const requestedParent = path.dirname(requested); const baseRoots = allowedTemporaryRoots();
  const rawParent = explicitParent === null ? requestedParent : path.resolve(explicitParent);
  if (rawParent !== requestedParent) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_PARENT_MISMATCH");
  const parentLeaf = fs.lstatSync(rawParent); const canonicalParent = fs.realpathSync(rawParent);
  if ((!parentLeaf.isDirectory() && !(explicitParent === null && parentLeaf.isSymbolicLink() && baseRoots.includes(canonicalParent))) || (explicitParent !== null && parentLeaf.isSymbolicLink())) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_PARENT_UNSAFE");
  const parent = identity(canonicalParent); const parentParent = fs.realpathSync(path.dirname(rawParent));
  if (explicitParent === null ? !baseRoots.includes(parent.canonicalPath) : !baseRoots.includes(parentParent)) throw new Error("OFFLINE_AUTOPILOT_DISPOSABLE_RUNTIME_REQUIRED");
  return parent;
}
export function createOfflineRuntimeRootGuard(runtimeRoot, { allowedParent = null } = {}) {
  const requested = path.resolve(runtimeRoot); const parent = allowedRuntimeParent(requested, allowedParent); const candidate = path.join(parent.canonicalPath, path.basename(requested));
  if (isRealTarget(candidate)) throw new Error("OFFLINE_AUTOPILOT_DISPOSABLE_RUNTIME_REQUIRED");
  try { fs.lstatSync(requested); throw new Error("OFFLINE_AUTOPILOT_RUNTIME_LEAF_EXISTS"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  fs.mkdirSync(candidate, { recursive: false, mode: 0o700 });
  const runtime = identity(candidate);
  if (runtime.type !== "directory" || runtime.canonicalPath !== candidate || path.dirname(runtime.canonicalPath) !== parent.canonicalPath) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_IDENTITY_INVALID");
  const guard = Object.freeze({ root: candidate, parent, runtime });
  assertOfflineRuntimeRootGuard(guard); return guard;
}
export function assertOfflineRuntimeRootGuard(guard) {
  const currentParent = identity(guard.parent.canonicalPath); const currentRuntime = identity(guard.root);
  if (!sameIdentity(currentParent, guard.parent) || !sameIdentity(currentRuntime, guard.runtime) || currentRuntime.type !== "directory" || path.dirname(currentRuntime.canonicalPath) !== currentParent.canonicalPath) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_IDENTITY_DRIFT");
  return true;
}
export function sealOfflineRuntimeRootGuard(guard) {
  assertOfflineRuntimeRootGuard(guard);
  const record = { schemaVersion: 1, parent: guard.parent, runtime: guard.runtime };
  fs.writeFileSync(path.join(guard.root, RUNTIME_IDENTITY_FILE), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  assertOfflineRuntimeRootGuard(guard); return guard.root;
}
function resumeOfflineRuntimeRoot(runtimeRoot, allowedParent) {
  const requested = path.resolve(runtimeRoot); const leaf = fs.lstatSync(requested);
  if (leaf.isSymbolicLink()) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_SYMLINK_LEAF");
  if (!leaf.isDirectory()) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_LEAF_NOT_DIRECTORY");
  const parent = allowedRuntimeParent(requested, allowedParent); const runtime = identity(requested); const markerPath = path.join(runtime.canonicalPath, RUNTIME_IDENTITY_FILE);
  let markerLeaf; try { markerLeaf = fs.lstatSync(markerPath); } catch (error) { if (error.code === "ENOENT") throw new Error("OFFLINE_AUTOPILOT_RUNTIME_LEAF_EXISTS"); throw error; }
  if (markerLeaf.isSymbolicLink() || !markerLeaf.isFile()) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_IDENTITY_MARKER_UNSAFE");
  const marker = parseJsonStrict(fs.readFileSync(markerPath, "utf8")); const guard = Object.freeze({ root: runtime.canonicalPath, parent, runtime });
  if (marker.schemaVersion !== 1 || !sameIdentity(marker.parent, parent) || !sameIdentity(marker.runtime, runtime)) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_IDENTITY_DRIFT");
  assertOfflineRuntimeRootGuard(guard); return guard.root;
}
export function prepareOfflineRuntimeRoot(runtimeRoot, { allowedParent = null } = {}) {
  const requested = path.resolve(runtimeRoot);
  try { fs.lstatSync(requested); return resumeOfflineRuntimeRoot(requested, allowedParent); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return sealOfflineRuntimeRootGuard(createOfflineRuntimeRootGuard(requested, { allowedParent }));
  }
}
function createTarget(root, now) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 }); git(root, ["init", "-b", "main"], { write: true }); fs.writeFileSync(path.join(root, "README.md"), "# Disposable offline autopilot target\n", { mode: 0o644 }); git(root, ["add", "README.md"], { write: true }); git(root, ["-c", "user.name=Offline Fixture", "-c", "user.email=offline@example.invalid", "commit", "--no-gpg-sign", "-m", "offline fixture baseline"], { write: true, env: { GIT_AUTHOR_DATE: now, GIT_COMMITTER_DATE: now } }); const baseline = git(root, ["rev-parse", "HEAD"]).stdout.trim(); git(root, ["branch", "self-improvement", baseline], { write: true }); git(root, ["checkout", "self-improvement"], { write: true }); return baseline;
}
function approval(runId) {
  return { approvalId: `offline-authorization:${runId}`, scope: "Add only the fictional offline educational fixture-reading guide in the disposable target.", allowedChanges: [{ path: PHASE2.pilotPath, operation: "ADD" }], forbiddenChanges: ["No production target", "No network", "No providers", "No publication", "No deployment", "No scheduling", "No paid execution", "No governance or operational instructions"], acceptanceCriteria: [{ id: "offline-educational-guide", description: "The disposable candidate contains one fictional offline educational guide." }], validationRequirements: [{ id: "validate-exact-add-scope", description: "Verify the actual candidate is exactly one regular non-executable ADD at the approved path." }, { id: "validate-fictional-offline-content", description: "Verify the actual content is fictional, offline, educational, and at most 800 words." }, { id: "validate-prohibited-content-absence", description: "Verify prohibited provider, secret, production, deployment, and billing content is absent." }] };
}
function initializeRun(root, scenario, controllerRoot, now) {
  const targetRoot = path.join(root, "disposable-target"); const statePath = path.join(root, "controller-state.json"); const journalPath = path.join(root, "execution-journal.json"); const baseline = createTarget(targetRoot, now); const runId = `offline-autopilot:${crypto.randomUUID()}`; const authorization = approval(runId); const authorizationBinding = { authorizationId: authorization.approvalId, authorizationDigest: sha256Canonical(authorization), disposable: true };
  initializeController(statePath, { controllerId: "gov-002-offline-autopilot", repositoryId: `offline-repository:${runId}`, evidenceMode: "OFFLINE_FIXTURE", ownerId: `offline-owner:${runId}`, targetRoot, approval: authorization });
  const controller = controllerReleaseIdentity(controllerRoot); initializeExecutionJournal(journalPath, { runId, scenario, controller, authorization: authorizationBinding, executionPolicyDigest: OFFLINE_EXECUTION_POLICY_DIGEST, adapterVersion: OFFLINE_FIXTURE_ADAPTER_VERSION, adapterDigest: OFFLINE_FIXTURE_DIGEST, createdAt: now });
  enqueueRequest({ statePath, ownerId: `offline-owner:${runId}`, ownerGeneration: 1, request: { schemaVersion: 2, requestId: runId, repositoryId: `offline-repository:${runId}`, targetRoot, targetBranch: "self-improvement", baselineCommit: baseline, createdAt: now }, now });
  const run = { schemaVersion: 1, runId, scenario, targetRoot: fs.realpathSync(targetRoot), statePath, journalPath, workspacesRoot: path.join(root, "workspace-runtime"), integrationPreparationPath: path.join(root, "integration-preparation.json"), controller, authorization: authorizationBinding, baseline, createdAt: now };
  replaceStateAtomic(path.join(root, "offline-run.json"), run); return run;
}
function loadRun(root) { return JSON.parse(fs.readFileSync(path.join(root, "offline-run.json"), "utf8")); }

export function runOfflineAutopilot({ runtimeRoot, scenario = "success", controllerRoot = process.cwd(), expectedControllerCommit = null, inject = null, now = "2026-09-27T12:00:00.000Z", allowedRuntimeParent = null }) {
  if (!OFFLINE_FIXTURE_SCENARIOS.includes(scenario)) throw new Error("OFFLINE_SCENARIO_UNSUPPORTED"); const root = prepareOfflineRuntimeRoot(runtimeRoot, { allowedParent: allowedRuntimeParent });
  const runnerLock = acquireLock(path.join(root, "offline-runner.lock"), { controllerId: "offline-autopilot", generation: 1, pid: process.pid }); if (!runnerLock.acquired) throw Object.assign(new Error("OFFLINE_AUTOPILOT_ALREADY_RUNNING"), { code: "OFFLINE_AUTOPILOT_ALREADY_RUNNING" });
  try {
    const run = fs.existsSync(path.join(root, "offline-run.json")) ? loadRun(root) : initializeRun(root, scenario, controllerRoot, now);
    if (run.scenario !== scenario || run.controller.root !== fs.realpathSync(controllerRoot)) throw new Error("OFFLINE_RUN_BINDING_MISMATCH");
    const currentController = controllerReleaseIdentity(controllerRoot); if (currentController.commit !== run.controller.commit || currentController.tree !== run.controller.tree || (expectedControllerCommit !== null && currentController.commit !== expectedControllerCommit)) throw new Error("OFFLINE_CONTROLLER_RELEASE_STALE");
    const recovery = reconcileExecutionJournal({ journalPath: run.journalPath, statePath: run.statePath, now }); const journalAfterRecovery = JSON.parse(fs.readFileSync(run.journalPath, "utf8")); if (journalAfterRecovery.status === "RECONCILIATION_REQUIRED") throw new Error("OFFLINE_AUTOPILOT_RECONCILIATION_REQUIRED");
    const transport = new OfflineFixtureTransport({ scenario }); let completedRoles = 0; let tick = Date.parse(now);
    while (true) {
      const state = readState(run.statePath); const cycle = state.cycles.find((item) => item.id === state.activeCycleId) ?? state.cycles.at(-1);
      if (cycle?.status === "REVIEW" && cycle.stage === "AWAITING_INTEGRATION") {
        const journal = JSON.parse(fs.readFileSync(run.journalPath, "utf8")); const receipts = journal.executions.filter((item) => item.status === "SUBMITTED"); const preparation = createIntegrationPreparation({ filePath: run.integrationPreparationPath, runId: run.runId, cycle, executionReceipts: receipts, controller: run.controller, now: new Date(tick += 1000).toISOString() });
        journal.status = "INTEGRATION_PREPARATION"; journal.updatedAt = preparation.createdAt; replaceStateAtomic(run.journalPath, journal);
        return { status: "INTEGRATION_PREPARATION", run, cycle: structuredClone(cycle), preparation, executions: receipts, recovery, providerCalls: 0, networkCalls: 0, protectedTargetMutations: 0, productionIntegrationIntents: 0 };
      }
      if (!state.pendingTaskId) throw new Error("OFFLINE_AUTOPILOT_NO_PENDING_TASK"); const task = state.tasks.find((item) => item.taskId === state.pendingTaskId); if (!task || task.evidenceMode !== "OFFLINE_FIXTURE") throw new Error("OFFLINE_AUTOPILOT_TASK_INVALID");
      if (["BUILDER_IMPLEMENTATION", "ANALYST_REVIEW"].includes(task.purpose)) preparePendingWorkspace({ statePath: run.statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, taskId: task.taskId, runtimeRoot: run.workspacesRoot, now: new Date(tick += 1000).toISOString() });
      const roleInject = inject?.afterRoles === completedRoles ? inject.phase : null;
      executeBoundRole({ statePath: run.statePath, journalPath: run.journalPath, task, transport, runtimeRoot: root, controllerRoot, metadata: { controller: run.controller, authorization: run.authorization, executionPolicyDigest: OFFLINE_EXECUTION_POLICY_DIGEST, adapterVersion: OFFLINE_FIXTURE_ADAPTER_VERSION, adapterDigest: OFFLINE_FIXTURE_DIGEST }, now: new Date(tick += 1000).toISOString(), inject: roleInject });
      completedRoles += 1; if (inject?.betweenRoles === completedRoles) throw Object.assign(new Error("INJECTED_CRASH_BETWEEN_ROLES"), { code: "INJECTED_CRASH_BETWEEN_ROLES" });
      if (completedRoles > 20) throw new Error("OFFLINE_AUTOPILOT_STEP_LIMIT");
    }
  } finally { runnerLock.release(); }
}
