import path from "node:path";
import fs from "node:fs";
import { PHASE2, sha256Canonical } from "./contracts.mjs";
import { initializeStateV2, mutateStateV2, readState } from "./local-store.mjs";
import { createRoleTask, emptyEvidence } from "./task-renderer.mjs";
import { validateAuthorization, validateMachineStateV2 } from "./validate.mjs";
import { createIndependentWorkspace } from "./workspaces.mjs";

export const REAL_TARGET_ROOT = "/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent";

export function isRealTarget(root) {
  try { return fs.realpathSync(root) === fs.realpathSync(REAL_TARGET_ROOT); } catch { return path.resolve(root) === path.resolve(REAL_TARGET_ROOT); }
}

export function createInitialState(config) {
  if (isRealTarget(config.targetRoot) || config.realPilot === true || PHASE2.realPilotActivation) throw Object.assign(new Error("REAL_PILOT_NOT_AUTHORIZED"), { code: "REAL_PILOT_NOT_AUTHORIZED" });
  validateAuthorization(config.approval);
  const state = {
    schemaVersion: 2, controllerId: config.controllerId, repositoryId: config.repositoryId, evidenceMode: config.evidenceMode ?? "SIMULATED", stateVersion: 0,
    owner: { id: config.ownerId, generation: 1 }, queue: [], activeCycleId: null, humanHold: false, approval: structuredClone(config.approval),
    capabilities: { realPilotActivation: false, liveProviders: false, network: false, publication: false, scheduling: false },
    cycles: [], plans: [], tasks: [], pendingTaskId: null, results: [], receipts: [], iterations: [], reviews: [], summaries: [], outbox: [], workspaces: [], timings: [], checkpointIntents: [], checkpointReceipts: [], integrationIntents: [], integrationOutcomes: [], migration: null,
  };
  validateMachineStateV2(state); return state;
}

export function initializeController(statePath, config) { return initializeStateV2(statePath, createInitialState(config)); }

function bindingFor(state, cycle, overrides = {}) {
  return {
    ownerId: state.owner.id, ownerGeneration: state.owner.generation, issuedStateVersion: state.stateVersion + 1,
    baselineCommit: cycle.baselineCommit, iterationBaseCommit: cycle.iterationBaseCommit, expectedTargetBranch: cycle.targetBranch, expectedTargetTip: cycle.expectedTargetTip,
    workspaceId: null, candidateCommit: null, reviewedCommit: null, ...overrides,
  };
}
function evidenceFor(state, cycleId) {
  const records = [];
  for (const receipt of state.receipts.filter((item) => state.tasks.find((task) => task.taskId === item.taskId)?.cycleId === cycleId)) {
    const result = state.results.find((item) => item.taskId === receipt.taskId);
    records.push({ type: "result", id: receipt.taskId, digest: receipt.resultDigest, content: structuredClone(result.result) });
  }
  for (const summary of state.summaries.filter((item) => item.cycleId === cycleId)) records.push({ type: "summary", id: summary.id, digest: summary.digest, content: structuredClone(summary) });
  return emptyEvidence(records);
}
function taskId(cycle, purpose) { return `${cycle.id}:${purpose.toLowerCase()}:i${cycle.iteration}:p${cycle.planRevision}`; }
export function buildTask(state, cycle, purpose, now, overrides = {}) {
  const role = purpose.startsWith("ARCHITECT") ? "architect" : purpose.startsWith("BUILDER") ? "builder" : "analyst";
  const carriedRevision = purpose === "ARCHITECT_REVISION" ? cycle.planRevision - 1 : cycle.planRevision;
  const approvedPlan = state.plans.find((item) => item.cycleId === cycle.id && item.revision === carriedRevision);
  const plan = purpose === "ARCHITECT_PLAN" ? { revision: 1, digest: null, content: null } : { revision: approvedPlan.revision, digest: approvedPlan.digest, content: approvedPlan.content };
  return createRoleTask({
    controllerId: state.controllerId, repositoryId: state.repositoryId, evidenceMode: state.evidenceMode, cycleId: cycle.id, taskId: taskId(cycle, purpose),
    iteration: cycle.iteration, planRevision: cycle.planRevision, role, purpose, binding: bindingFor(state, cycle, overrides), authorization: state.approval,
    plan, previousEvidence: evidenceFor(state, cycle.id), createdAt: now,
  });
}

function validateEnqueueRequest(request) {
  const fields = ["schemaVersion", "requestId", "repositoryId", "targetRoot", "targetBranch", "baselineCommit", "createdAt"];
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).sort().join() !== fields.sort().join()) throw new TypeError("request fields are invalid");
  if (request.schemaVersion !== 2 || typeof request.requestId !== "string" || request.repositoryId.length === 0 || request.targetBranch !== PHASE2.pilotBranch || !/^[0-9a-f]{40}$/u.test(request.baselineCommit) || !/^\d{4}-\d{2}-\d{2}T.*Z$/u.test(request.createdAt)) throw new TypeError("request is invalid");
  if (isRealTarget(request.targetRoot)) throw Object.assign(new Error("REAL_PILOT_NOT_AUTHORIZED"), { code: "REAL_PILOT_NOT_AUTHORIZED" });
}

export function enqueueRequest({ statePath, ownerId, ownerGeneration, request, now = request.createdAt }) {
  validateEnqueueRequest(request);
  return mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) {
    if (request.repositoryId !== state.repositoryId) throw new Error("WRONG_REPOSITORY");
    if (state.activeCycleId !== null || state.humanHold) throw new Error("CONTROLLER_NOT_AVAILABLE");
    if (state.queue.some((item) => item.requestId === request.requestId) || state.cycles.some((item) => item.requestId === request.requestId)) throw new Error("DUPLICATE_REQUEST");
    const cycle = { id: `cycle:${request.requestId}`, requestId: request.requestId, status: "AWAITING_HUMAN_ROLE", stage: "ARCHITECT_PLAN", targetRoot: fs.realpathSync(request.targetRoot), targetBranch: request.targetBranch, baselineCommit: request.baselineCommit, expectedTargetTip: request.baselineCommit, iterationBaseCommit: request.baselineCommit, iteration: 1, planRevision: 1, candidateCommit: null, analystResultDigest: null, architectDecision: null, integrationStatus: "NOT_STARTED", createdAt: now };
    const next = { ...state, stateVersion: state.stateVersion + 1, activeCycleId: cycle.id, cycles: [...state.cycles, cycle] };
    const task = buildTask(state, cycle, "ARCHITECT_PLAN", now); next.tasks.push(task); next.pendingTaskId = task.taskId;
    return { state: next, value: task };
  }});
}

export function registerWorkspace({ statePath, ownerId, ownerGeneration, taskId: id, workspace }) {
  return mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) {
    const task = state.tasks.find((item) => item.taskId === id); if (!task) throw new Error("TASK_NOT_FOUND");
    const expectedCommit = task.binding.candidateCommit ?? task.binding.iterationBaseCommit;
    if (task.role !== workspace.role || task.binding.workspaceId !== workspace.workspaceId || expectedCommit !== workspace.expectedCommit || state.workspaces.some((item) => item.workspaceId === workspace.workspaceId)) throw new Error("WORKSPACE_REGISTRATION_CONFLICT");
    state.workspaces.push({ ...structuredClone(workspace), taskId: id, repositoryId: state.repositoryId }); state.stateVersion += 1;
    return { state, value: workspace };
  }});
}

export function preparePendingWorkspace({ statePath, ownerId, ownerGeneration, taskId: id, runtimeRoot, now }) {
  const state = readState(statePath); validateMachineStateV2(state);
  const task = state.tasks.find((item) => item.taskId === id); if (!task || state.pendingTaskId !== id) throw new Error("TASK_NOT_PENDING");
  if (!["builder", "analyst"].includes(task.role) || !task.binding.workspaceId) throw new Error("TASK_WORKSPACE_NOT_REQUIRED");
  const existing = state.workspaces.find((item) => item.taskId === id); if (existing) return { status: "ALREADY_PREPARED", workspace: structuredClone(existing) };
  const cycle = findCycle(state, task.cycleId); let sourceRoot;
  if (task.role === "builder" && task.iteration === 1) sourceRoot = cycle.targetRoot;
  else {
    const subject = task.role === "builder" ? task.binding.iterationBaseCommit : task.binding.reviewedCommit;
    const checkpoint = state.checkpointReceipts.find((item) => item.candidateCommit === subject); if (!checkpoint) throw new Error("SOURCE_CHECKPOINT_NOT_FOUND");
    const source = state.workspaces.find((item) => item.workspaceId === checkpoint.workspaceId); if (!source) throw new Error("SOURCE_WORKSPACE_NOT_FOUND"); sourceRoot = source.root;
  }
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const workspace = createIndependentWorkspace({ sourceRoot, runtimeRoot, workspaceId: task.binding.workspaceId, commit: task.binding.candidateCommit ?? task.binding.iterationBaseCommit, role: task.role, registeredAt: now });
  registerWorkspace({ statePath, ownerId, ownerGeneration, taskId: id, workspace });
  return { status: "PREPARED", workspace };
}

export function controllerStatus(statePath) {
  const state = readState(statePath); validateMachineStateV2(state);
  const cycle = state.cycles.find((item) => item.id === state.activeCycleId) ?? null;
  const task = state.tasks.find((item) => item.taskId === state.pendingTaskId) ?? null;
  const timing = task ? state.timings.find((item) => item.taskId === task.taskId) ?? null : null;
  return { schemaVersion: 2, evidenceMode: state.evidenceMode, cycleId: state.activeCycleId, cycleStatus: cycle?.status ?? "IDLE", stage: cycle?.stage ?? null, pendingRole: task?.role ?? null, taskId: task?.taskId ?? null, roleStatus: timing?.status ?? (task ? "WAITING" : null), humanHold: state.humanHold, localCandidate: cycle?.candidateCommit ?? null, integrationStatus: cycle?.integrationStatus ?? null };
}

export function newestSummary(statePath) {
  const state = readState(statePath); validateMachineStateV2(state); return structuredClone(state.summaries.at(-1) ?? null);
}

export function findCycle(state, cycleId) { const cycle = state.cycles.find((item) => item.id === cycleId); if (!cycle) throw new Error("CYCLE_NOT_FOUND"); return cycle; }
export function summaryDigest(summary) { return sha256Canonical(Object.fromEntries(Object.entries(summary).filter(([key]) => key !== "digest"))); }

export function finalizeTerminalCycle(state, cycle, { status, stage, terminalReason, now, integration = null, humanHold = true }) {
  const id = `summary:${cycle.id}:final`; const existing = state.summaries.find((item) => item.id === id); if (existing) return existing;
  cycle.status = status; cycle.stage = stage; state.activeCycleId = null; state.pendingTaskId = null; state.humanHold = humanHold;
  const evidenceChain = [
    ...state.results.filter((item) => item.cycleId === cycle.id).map((item) => ({ type: "result", id: item.taskId, digest: item.resultDigest })),
    ...state.summaries.filter((item) => item.cycleId === cycle.id && item.type === "ITERATION").map((item) => ({ type: "summary", id: item.id, digest: item.digest })),
  ];
  const unsigned = {
    id, cycleId: cycle.id, type: "FINAL", evidenceMode: state.evidenceMode, terminalState: status, terminalReason, evidenceChain,
    iterations: state.iterations.filter((item) => item.cycleId === cycle.id).map((item) => ({ index: item.index, planRevision: item.planRevision, candidateCommit: item.candidateCommit, reviewResultDigest: item.reviewResultDigest })),
    planRevisions: state.plans.filter((item) => item.cycleId === cycle.id).map((item) => ({ revision: item.revision, digest: item.digest })),
    architectDecision: cycle.architectDecision, architectResultDigest: cycle.architectResultDigest ?? null,
    integration: integration ?? { status: "NOT_ATTEMPTED", oldTip: null, newTip: null, scopeDigest: null },
    productionImpact: "NONE_FIXTURE_ONLY", risks: terminalReason === "INTEGRATED" ? [] : [terminalReason], createdAt: now,
  };
  const summary = { ...unsigned, digest: summaryDigest(unsigned) }; state.summaries.push(summary);
  state.outbox.push({ id: `${state.repositoryId}:${cycle.id}:final`, status: "SIMULATED_ACCEPTED", payload: { summaryId: summary.id, summaryDigest: summary.digest, simulated: true } });
  return summary;
}

export async function runRehearsal(runtimeRoot, options = {}) {
  const { git, commitMetadata } = await import("./git-evidence.mjs");
  const { createIndependentWorkspace } = await import("./workspaces.mjs");
  const { createLocalCheckpoint } = await import("./local-checkpoint.mjs");
  const { integrateFixtureCandidate } = await import("./local-integration.mjs");
  const { submitRoleResult } = await import("./result-submission.mjs");
  const { finishRole, startRole } = await import("./role-timing.mjs");
  const { resultContextForTask } = await import("./validate.mjs");
  const { expectedValidationEntries } = await import("./validation-evidence.mjs");
  const root = path.resolve(runtimeRoot); fs.mkdirSync(root, { recursive: true });
  const fixture = path.join(root, "fixture-target"); const workspacesRoot = path.join(root, "workspace-runtime"); const statePath = path.join(root, "state.json"); fs.mkdirSync(fixture, { recursive: true }); fs.mkdirSync(workspacesRoot, { recursive: true });
  git(fixture, ["init", "-b", "main"], { write: true }); fs.writeFileSync(path.join(fixture, "README.md"), "# Disposable rehearsal fixture\n", "utf8"); git(fixture, ["add", "README.md"], { write: true }); git(fixture, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "fixture baseline"], { write: true, env: { GIT_AUTHOR_DATE: "2026-09-21T08:00:00.000Z", GIT_COMMITTER_DATE: "2026-09-21T08:00:00.000Z" } });
  const baseline = git(fixture, ["rev-parse", "HEAD"]).stdout.trim(); git(fixture, ["branch", "self-improvement", baseline], { write: true }); git(fixture, ["checkout", "self-improvement"], { write: true });
  const approval = { approvalId: "gov-002-rehearsal", scope: "Add the fictional offline fixture-reading guide only.", allowedChanges: [{ path: PHASE2.pilotPath, operation: "ADD" }], forbiddenChanges: ["No providers", "No network", "No publication", "No scheduling", "No production"], acceptanceCriteria: [{ id: "criterion-offline-guide", description: "Create a fictional offline fixture-reading guide." }], validationRequirements: [{ id: "validate-offline-guide", description: "Verify exact path and fictional offline content." }] };
  const ownerId = "rehearsal-builder"; initializeController(statePath, { controllerId: "gov-002-controller", repositoryId: "fixture-repository", evidenceMode: "SIMULATED", ownerId, targetRoot: fixture, approval });
  let tick = Date.parse("2026-09-21T08:00:00.000Z"); const now = () => new Date(tick += 1000).toISOString();
  enqueueRequest({ statePath, ownerId, ownerGeneration: 1, request: { schemaVersion: 2, requestId: "rehearsal-request", repositoryId: "fixture-repository", targetRoot: fixture, targetBranch: "self-improvement", baselineCommit: baseline, createdAt: now() } });
  const resultFor = (task, payload) => ({ schemaVersion: 2, taskDigest: task.taskDigest, context: resultContextForTask(task), outcome: "COMPLETED", payload });
  const executeRole = (task) => { startRole({ statePath, ownerId, ownerGeneration: 1, taskId: task.taskId, now: now() }); finishRole({ statePath, ownerId, ownerGeneration: 1, taskId: task.taskId, now: now() }); };
  const planPayload = (rationale, resolvesFindingIds = []) => ({ goal: "Create a fictional offline fixture-reading guide.", scope: approval.scope, allowedChanges: approval.allowedChanges, forbiddenChanges: approval.forbiddenChanges, acceptanceCriteria: approval.acceptanceCriteria, validationRequirements: approval.validationRequirements, risks: ["Fixture content could be mistaken for live data."], rationale, resolvesFindingIds });
  let state = readState(statePath); let task = state.tasks.find((item) => item.taskId === state.pendingTaskId); executeRole(task); submitRoleResult({ statePath, ownerId, ownerGeneration: 1, result: resultFor(task, planPayload("Initial simulated plan.")), now: now() });
  async function builderRound(content) {
    let current = readState(statePath); const builderTask = current.tasks.find((item) => item.taskId === current.pendingTaskId); const cycle = current.cycles[0]; const source = cycle.iteration === 1 ? fixture : [...current.workspaces].reverse().find((item) => item.role === "builder" && item.taskId !== builderTask.taskId)?.root;
    const workspace = createIndependentWorkspace({ sourceRoot: source, runtimeRoot: workspacesRoot, workspaceId: builderTask.binding.workspaceId, commit: cycle.iterationBaseCommit, role: "builder" }); registerWorkspace({ statePath, ownerId, ownerGeneration: 1, taskId: builderTask.taskId, workspace });
    executeRole(builderTask); const target = path.join(workspace.root, PHASE2.pilotPath); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content, "utf8");
    const checkpoint = createLocalCheckpoint({ statePath, ownerId, ownerGeneration: 1, taskId: builderTask.taskId, now: now() }).receipt; const validation = expectedValidationEntries(readState(statePath), builderTask);
    const payload = { candidateCommit: checkpoint.candidateCommit, parentCommit: checkpoint.parentCommit, treeId: checkpoint.treeId, changedFiles: [{ path: PHASE2.pilotPath, operation: cycle.iteration === 1 ? "ADD" : "MODIFY", mode: "100644" }], validation, deviations: [], blockers: [] };
    submitRoleResult({ statePath, ownerId, ownerGeneration: 1, result: resultFor(builderTask, payload), now: now() }); return checkpoint.candidateCommit;
  }
  const candidate1 = await builderRound("# Reading Offline Fixtures\n\nA fictional record has a stable id, title, and source field. Compare stable fields conceptually to spot a duplicate without contacting any live service.\n");
  state = readState(statePath); task = state.tasks.find((item) => item.taskId === state.pendingTaskId); const analyst1 = createIndependentWorkspace({ sourceRoot: state.workspaces.find((item) => item.role === "builder" && item.expectedCommit === baseline).root, runtimeRoot: workspacesRoot, workspaceId: task.binding.workspaceId, commit: candidate1, role: "analyst" }); registerWorkspace({ statePath, ownerId, ownerGeneration: 1, taskId: task.taskId, workspace: analyst1 });
  executeRole(task); const validation1 = expectedValidationEntries(readState(statePath), task); submitRoleResult({ statePath, ownerId, ownerGeneration: 1, result: resultFor(task, { reviewedCommit: candidate1, reviewState: "REVISE", findings: ["Clarify which fixture fields distinguish records."], requiredChanges: ["Add a record comparison example."], recommendations: [], validation: validation1 }), now: now() });
  state = readState(statePath); task = state.tasks.find((item) => item.taskId === state.pendingTaskId); executeRole(task); submitRoleResult({ statePath, ownerId, ownerGeneration: 1, result: resultFor(task, planPayload("Revision addresses the Analyst finding.", ["finding-record-comparison"])), now: now() });
  const candidate2 = await builderRound("# Reading Offline Fixtures\n\nA fictional fixture record contains `id`, `title`, `source`, and `publishedAt`. Distinguish records by stable source and id values. Conceptually, two records with the same normalized source and id are duplicates; no live lookup is needed.\n");
  state = readState(statePath); task = state.tasks.find((item) => item.taskId === state.pendingTaskId); const latestBuilder = [...state.workspaces].reverse().find((item) => item.role === "builder"); const analyst2 = createIndependentWorkspace({ sourceRoot: latestBuilder.root, runtimeRoot: workspacesRoot, workspaceId: task.binding.workspaceId, commit: candidate2, role: "analyst" }); registerWorkspace({ statePath, ownerId, ownerGeneration: 1, taskId: task.taskId, workspace: analyst2 });
  executeRole(task); submitRoleResult({ statePath, ownerId, ownerGeneration: 1, result: resultFor(task, { reviewedCommit: candidate2, reviewState: "PASS", findings: [], requiredChanges: [], recommendations: [], validation: expectedValidationEntries(readState(statePath), task) }), now: now() });
  state = readState(statePath); task = state.tasks.find((item) => item.taskId === state.pendingTaskId); executeRole(task); submitRoleResult({ statePath, ownerId, ownerGeneration: 1, result: resultFor(task, { reviewedCommit: candidate2, analystResultDigest: state.cycles[0].analystResultDigest, decision: "ACCEPT", rationale: "The independent simulated review passed the bounded fixture change.", recommendationDispositions: [] }), now: now() });
  if (options.stopBeforeIntegration) return { cycleId: "cycle:rehearsal-request", baseline, candidateCommits: [candidate1, candidate2], statePath, fixtureRoot: fixture, ownerId };
  integrateFixtureCandidate({ statePath, ownerId, ownerGeneration: 1, cycleId: "cycle:rehearsal-request", targetRoot: fixture, now: now(), fixture: true });
  state = readState(statePath); const iterationSummaries = state.summaries.filter((item) => item.type === "ITERATION"); const finalSummary = state.summaries.find((item) => item.type === "FINAL");
  return { cycleId: "cycle:rehearsal-request", baseline, candidateCommits: [candidate1, candidate2], reviewSummaryIds: iterationSummaries.map((item) => item.id), finalSummaryId: finalSummary.id, finalSummaryDigest: finalSummary.digest, integratedCommit: commitMetadata(fixture, "HEAD").commit, statePath, fixtureRoot: fixture };
}
