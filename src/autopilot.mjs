import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readState, replaceStateAtomic } from "./local-store.mjs";
import { PHASE2, sha256Canonical } from "./contracts.mjs";
import { controllerReleaseIdentity, executeBoundRole, initializeExecutionJournal, markExecutionJournalFailed, markExecutionJournalReady } from "./role-execution.mjs";
import { OfflineFixtureTransport, OFFLINE_FIXTURE_ADAPTER_VERSION, OFFLINE_FIXTURE_DIGEST, OFFLINE_FIXTURE_SCENARIOS } from "./adapters/offline-fixture.mjs";
import { enqueueRequest, initializeController, isRealTarget, preparePendingWorkspace } from "./coordinator.mjs";
import { git } from "./git-evidence.mjs";
import { AI_RADAR_SEARCH10_BRANCH, AI_RADAR_SEARCH10_REPOSITORY_PREFIX, AI_RADAR_SEARCH10_SCENARIO, aiRadarSearch10Approval, validateAiRadarSearch10Source } from "./scenarios/ai-radar-search10.mjs";

export const OFFLINE_EXECUTION_POLICY = Object.freeze({ version: "offline-autopilot-policy-v1", evidenceMode: "OFFLINE_FIXTURE", network: false, providers: false, publication: false, deployment: false, scheduling: false, paidExecution: false, maxRoleExecutionSeconds: 900, maxCycleExecutionSeconds: 5400, maxIterations: 3, stopAt: "READY_FOR_INTEGRATION", resume: false });
export const OFFLINE_EXECUTION_POLICY_DIGEST = sha256Canonical(OFFLINE_EXECUTION_POLICY);

function identity(filePath) {
  const stat = fs.lstatSync(filePath);
  return Object.freeze({ canonicalPath: fs.realpathSync(filePath), type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "other", device: stat.dev, inode: stat.ino, owner: stat.uid, mode: stat.mode & 0o7777 });
}
function sameIdentity(left, right) { return left.canonicalPath === right.canonicalPath && left.type === right.type && left.device === right.device && left.inode === right.inode && left.owner === right.owner && left.mode === right.mode; }
function allowedTemporaryRoots() { return [...new Set([fs.realpathSync(os.tmpdir()), fs.realpathSync("/private/tmp")])]; }
function approvedParent(runtimeRoot, explicitParent) {
  const requested = path.resolve(runtimeRoot); const rawParent = explicitParent === null ? path.dirname(requested) : path.resolve(explicitParent);
  if (rawParent !== path.dirname(requested)) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_PARENT_MISMATCH");
  const leaf = fs.lstatSync(rawParent); if (leaf.isSymbolicLink() && explicitParent !== null) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_PARENT_UNSAFE");
  const canonical = fs.realpathSync(rawParent); if (!fs.lstatSync(canonical).isDirectory()) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_PARENT_UNSAFE");
  const baseRoots = allowedTemporaryRoots(); const permitted = explicitParent === null ? baseRoots.includes(canonical) : baseRoots.includes(fs.realpathSync(path.dirname(canonical)));
  if (!permitted) throw new Error("OFFLINE_AUTOPILOT_DISPOSABLE_RUNTIME_REQUIRED");
  return identity(canonical);
}
export function createOfflineRuntimeRootGuard(runtimeRoot, { allowedParent = null } = {}) {
  const requested = path.resolve(runtimeRoot); const parent = approvedParent(requested, allowedParent); const candidate = path.join(parent.canonicalPath, path.basename(requested));
  if (isRealTarget(candidate)) throw new Error("OFFLINE_AUTOPILOT_DISPOSABLE_RUNTIME_REQUIRED");
  try { const existing = fs.lstatSync(requested); if (existing.isSymbolicLink()) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_SYMLINK_LEAF"); throw new Error("OFFLINE_AUTOPILOT_RUNTIME_LEAF_EXISTS"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  fs.mkdirSync(candidate, { recursive: false, mode: 0o700 }); const runtime = identity(candidate);
  if (runtime.type !== "directory" || runtime.canonicalPath !== candidate || path.dirname(runtime.canonicalPath) !== parent.canonicalPath) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_IDENTITY_INVALID");
  const guard = Object.freeze({ root: candidate, parent, runtime }); assertOfflineRuntimeRootGuard(guard); return guard;
}
export function assertOfflineRuntimeRootGuard(guard) {
  const currentParent = identity(guard.parent.canonicalPath); const currentRuntime = identity(guard.root);
  if (!sameIdentity(currentParent, guard.parent) || !sameIdentity(currentRuntime, guard.runtime) || currentRuntime.type !== "directory" || path.dirname(currentRuntime.canonicalPath) !== currentParent.canonicalPath) throw new Error("OFFLINE_AUTOPILOT_RUNTIME_IDENTITY_DRIFT");
  return true;
}
export function prepareOfflineRuntimeRoot(runtimeRoot, options = {}) { return createOfflineRuntimeRootGuard(runtimeRoot, options).root; }

function derivedPaths(root) { return Object.freeze({ targetRoot: path.join(root, "disposable-target"), statePath: path.join(root, "controller-state.json"), journalPath: path.join(root, "execution-journal.json"), workspacesRoot: path.join(root, "workspace-runtime"), statusPath: path.join(root, "offline-status.json"), summaryPath: path.join(root, "offline-summary.json") }); }
function assertInternalPath(guard, candidate) { const relative = path.relative(guard.root, candidate); if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("OFFLINE_AUTOPILOT_INTERNAL_PATH_INVALID"); assertOfflineRuntimeRootGuard(guard); }
function writeProjection(guard, paths, value) { assertInternalPath(guard, paths.statusPath); replaceStateAtomic(paths.statusPath, value); }
function progress(guard, paths, runId, phase, detail = null) { const record = { schemaVersion: 1, runId, phase, detail, updatedAt: new Date().toISOString() }; writeProjection(guard, paths, record); return record; }

function createTarget(guard, root, now) {
  assertInternalPath(guard, root); fs.mkdirSync(root, { recursive: false, mode: 0o700 }); assertOfflineRuntimeRootGuard(guard);
  git(root, ["init", "-b", "main"], { write: true }); fs.writeFileSync(path.join(root, "README.md"), "# Disposable offline autopilot target\n", { mode: 0o644 }); git(root, ["add", "README.md"], { write: true });
  git(root, ["-c", "user.name=Offline Fixture", "-c", "user.email=offline@example.invalid", "commit", "--no-gpg-sign", "-m", "offline fixture baseline"], { write: true, env: { GIT_AUTHOR_DATE: now, GIT_COMMITTER_DATE: now } });
  const baseline = git(root, ["rev-parse", "HEAD"]).stdout.trim(); git(root, ["branch", "self-improvement", baseline], { write: true }); git(root, ["checkout", "self-improvement"], { write: true }); return baseline;
}
function approval(runId) {
  return { approvalId: `offline-authorization:${runId}`, scope: "Add only the fictional offline educational fixture-reading guide in the disposable target.", allowedChanges: [{ path: PHASE2.pilotPath, operation: "ADD" }], forbiddenChanges: ["No production target", "No network", "No providers", "No publication", "No deployment", "No scheduling", "No paid execution", "No governance or operational instructions"], acceptanceCriteria: [{ id: "offline-educational-guide", description: "The disposable candidate contains one fictional offline educational guide." }], validationRequirements: [{ id: "validate-exact-add-scope", description: "Verify the actual candidate is exactly one regular non-executable ADD at the approved path." }, { id: "validate-fictional-offline-content", description: "Verify the exact reviewed fictional offline educational fixture template." }, { id: "validate-prohibited-content-absence", description: "Verify prohibited provider, secret, production, operational, deployment, and billing content is absent." }] };
}
function initializeFreshRun(guard, paths, scenario, controllerRoot, now, sourceRoot) {
  const runId = `offline-autopilot:${crypto.randomUUID()}`; progress(guard, paths, runId, "CREATED");
  const search10 = scenario === AI_RADAR_SEARCH10_SCENARIO;
  if (search10 && sourceRoot === null) throw new Error("AI_RADAR_SEARCH10_SOURCE_REQUIRED");
  if (!search10 && sourceRoot !== null) throw new Error("OFFLINE_AUTOPILOT_SOURCE_NOT_ALLOWED");
  const sourceIdentity = search10 ? validateAiRadarSearch10Source(sourceRoot) : null;
  const targetRoot = search10 ? sourceIdentity.canonicalPath : paths.targetRoot;
  const baseline = search10 ? sourceIdentity.commit : createTarget(guard, targetRoot, now);
  const targetBranch = search10 ? AI_RADAR_SEARCH10_BRANCH : "self-improvement";
  const repositoryId = search10 ? `${AI_RADAR_SEARCH10_REPOSITORY_PREFIX}${runId}` : `offline-repository:${runId}`;
  const authorization = search10 ? aiRadarSearch10Approval(runId) : approval(runId); const authorizationBinding = { authorizationId: authorization.approvalId, authorizationDigest: sha256Canonical(authorization), disposable: true };
  assertOfflineRuntimeRootGuard(guard); initializeController(paths.statePath, { controllerId: "gov-002-offline-autopilot", repositoryId, evidenceMode: "OFFLINE_FIXTURE", ownerId: `offline-owner:${runId}`, targetRoot, approval: authorization });
  const controller = controllerReleaseIdentity(controllerRoot); assertOfflineRuntimeRootGuard(guard); initializeExecutionJournal(paths.journalPath, { runId, scenario, controller, authorization: authorizationBinding, executionPolicyDigest: OFFLINE_EXECUTION_POLICY_DIGEST, adapterVersion: OFFLINE_FIXTURE_ADAPTER_VERSION, adapterDigest: OFFLINE_FIXTURE_DIGEST, createdAt: now });
  assertOfflineRuntimeRootGuard(guard); enqueueRequest({ statePath: paths.statePath, ownerId: `offline-owner:${runId}`, ownerGeneration: 1, request: { schemaVersion: 2, requestId: runId, repositoryId, targetRoot, targetBranch, baselineCommit: baseline, createdAt: now }, now });
  return Object.freeze({ ...paths, runId, scenario, controller, authorization: authorizationBinding, baseline, targetRoot, targetBranch, sourceIdentity });
}
function phaseFor(task) { if (["ARCHITECT_PLAN", "ARCHITECT_REVISION"].includes(task.purpose)) return "ARCHITECT"; if (task.purpose === "BUILDER_IMPLEMENTATION") return "BUILDER"; if (task.purpose === "ANALYST_REVIEW") return "ANALYST"; if (task.purpose === "ARCHITECT_FINAL_DECISION") return "ARCHITECT_FINAL"; throw new Error("OFFLINE_AUTOPILOT_TASK_INVALID"); }
function finalSummary(run, cycle, executions) {
  const unsigned = { schemaVersion: 1, status: "READY_FOR_INTEGRATION", evidenceMode: "OFFLINE_FIXTURE", runId: run.runId, cycleId: cycle.id, scenario: run.scenario, baselineCommit: run.baseline, candidateCommit: cycle.candidateCommit, iteration: cycle.iteration, architectDecision: cycle.architectDecision, ...(run.sourceIdentity === null ? {} : { sourceIdentity: run.sourceIdentity }), executionReceiptDigests: executions.map((item) => item.receiptDigest), productionIntegrationIntentCreated: false, targetMutationPerformed: false, providerCalls: 0, networkCalls: 0, createdAt: new Date().toISOString() };
  return Object.freeze({ ...unsigned, summaryDigest: sha256Canonical(unsigned) });
}

function runCore({ runtimeRoot, scenario, sourceRoot, controllerRoot, expectedControllerCommit, allowedRuntimeParent, executionControl, transportOverrides, inject }) {
  if (!OFFLINE_FIXTURE_SCENARIOS.includes(scenario)) throw new Error("OFFLINE_SCENARIO_UNSUPPORTED"); const guard = createOfflineRuntimeRootGuard(runtimeRoot, { allowedParent: allowedRuntimeParent }); const paths = derivedPaths(guard.root); let run = null;
  try {
    const now = executionControl?.clock?.wallNow?.() ?? new Date().toISOString(); run = initializeFreshRun(guard, paths, scenario, controllerRoot, now, sourceRoot);
    const currentController = controllerReleaseIdentity(controllerRoot); if (currentController.commit !== run.controller.commit || currentController.tree !== run.controller.tree || (expectedControllerCommit !== null && currentController.commit !== expectedControllerCommit)) throw new Error("OFFLINE_CONTROLLER_RELEASE_STALE");
    const transport = new OfflineFixtureTransport({ scenario, overrides: transportOverrides }); let completedRoles = 0;
    while (true) {
      assertOfflineRuntimeRootGuard(guard); const state = readState(run.statePath); const cycle = state.cycles.find((item) => item.id === state.activeCycleId) ?? state.cycles.at(-1);
      if (cycle?.status === "REVIEW" && cycle.stage === "AWAITING_INTEGRATION") {
        const journal = JSON.parse(fs.readFileSync(run.journalPath, "utf8")); const executions = journal.executions.filter((item) => item.status === "SUBMITTED"); const summary = finalSummary(run, cycle, executions);
        assertOfflineRuntimeRootGuard(guard); replaceStateAtomic(run.summaryPath, summary); markExecutionJournalReady(run.journalPath, summary.createdAt); progress(guard, paths, run.runId, "READY_FOR_INTEGRATION", { candidateCommit: cycle.candidateCommit, iteration: cycle.iteration });
        return { status: "READY_FOR_INTEGRATION", run, cycle: structuredClone(cycle), summary, executions, providerCalls: 0, networkCalls: 0, protectedTargetMutations: 0, productionIntegrationIntents: 0 };
      }
      if (!state.pendingTaskId) throw new Error("OFFLINE_AUTOPILOT_NO_PENDING_TASK"); const task = state.tasks.find((item) => item.taskId === state.pendingTaskId); if (!task || task.evidenceMode !== "OFFLINE_FIXTURE") throw new Error("OFFLINE_AUTOPILOT_TASK_INVALID");
      progress(guard, paths, run.runId, phaseFor(task), { taskId: task.taskId, iteration: task.iteration });
      if (["BUILDER_IMPLEMENTATION", "ANALYST_REVIEW"].includes(task.purpose)) { assertOfflineRuntimeRootGuard(guard); preparePendingWorkspace({ statePath: run.statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, taskId: task.taskId, runtimeRoot: run.workspacesRoot, now: new Date().toISOString() }); }
      if (inject?.afterRoles === completedRoles) throw Object.assign(new Error(inject.code ?? "INJECTED_OFFLINE_FAILURE"), { code: inject.code ?? "INJECTED_OFFLINE_FAILURE" });
      executeBoundRole({ statePath: run.statePath, journalPath: run.journalPath, task, transport, runtimeRoot: guard.root, controllerRoot, metadata: { controller: run.controller, authorization: run.authorization, executionPolicyDigest: OFFLINE_EXECUTION_POLICY_DIGEST, adapterVersion: OFFLINE_FIXTURE_ADAPTER_VERSION, adapterDigest: OFFLINE_FIXTURE_DIGEST }, executionControl, onPhase(name) { if (name === "VALIDATING") progress(guard, paths, run.runId, "VALIDATING", { taskId: task.taskId, iteration: task.iteration }); } });
      completedRoles += 1; if (completedRoles > 20) throw new Error("OFFLINE_AUTOPILOT_STEP_LIMIT");
    }
  } catch (error) {
    try { if (run && fs.existsSync(run.journalPath)) markExecutionJournalFailed(run.journalPath, new Date().toISOString(), error.code ?? error.message); progress(guard, paths, run?.runId ?? "uninitialized", "FAILED", { code: error.code ?? error.message }); } catch {}
    throw error;
  }
}

export function runOfflineAutopilot({ runtimeRoot, scenario = "success", sourceRoot = null, controllerRoot = process.cwd(), expectedControllerCommit = null }) { return runCore({ runtimeRoot, scenario, sourceRoot, controllerRoot, expectedControllerCommit, allowedRuntimeParent: null, executionControl: null, transportOverrides: {}, inject: null }); }
export function runOfflineAutopilotForTest({ runtimeRoot, scenario = "success", sourceRoot = null, controllerRoot = process.cwd(), expectedControllerCommit = null, allowedRuntimeParent = null, executionControl = null, transportOverrides = {}, inject = null }) { return runCore({ runtimeRoot, scenario, sourceRoot, controllerRoot, expectedControllerCommit, allowedRuntimeParent, executionControl, transportOverrides, inject }); }
