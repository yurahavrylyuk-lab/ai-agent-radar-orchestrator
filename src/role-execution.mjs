import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256Canonical } from "./contracts.mjs";
import { commitMetadata } from "./git-evidence.mjs";
import { acquireLock, readState, replaceStateAtomic } from "./local-store.mjs";
import { createLocalCheckpoint } from "./local-checkpoint.mjs";
import { offlineExecutorSandboxProfile } from "./operator-boundary.mjs";
import { createExecutionFrame, decodeExecutionFrame, encodeExecutionFrame, EXECUTOR_EVENT_TYPES, validateExecutionFrame } from "./role-execution-protocol.mjs";
import { finishRole, startRole } from "./role-timing.mjs";
import { submitRoleResult } from "./result-submission.mjs";
import { executedValidationEntries } from "./validation-evidence.mjs";

export const EXECUTION_STATES = Object.freeze(["PREPARING", "CONFINEMENT_VERIFIED", "EXECUTING", "RESULT_CAPTURED", "EXECUTION_FINISHED", "SUBMITTED", "ABORTED", "RECONCILIATION_REQUIRED"]);

const JOURNAL_FIELDS = ["schemaVersion", "runId", "evidenceMode", "scenario", "controller", "authorization", "executionPolicyDigest", "adapterVersion", "adapterDigest", "status", "executions", "createdAt", "updatedAt"];
const EXECUTION_FIELDS = ["schemaVersion", "executionId", "taskId", "taskDigest", "cycleId", "role", "purpose", "iteration", "planRevision", "controller", "authorization", "adapterVersion", "adapterDigest", "executionPolicyDigest", "workspaceIdentity", "executableIdentity", "confinementEvidence", "monotonicStartedNs", "activeNs", "toolRequestDigest", "toolResultDigest", "candidateEvidence", "result", "resultDigest", "submissionReceipt", "receiptDigest", "status", "transitions"];
function exactAllowed(value, required, optional, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}_INVALID`);
  const allowed = new Set([...required, ...optional]); if (Object.keys(value).some((key) => !allowed.has(key)) || required.some((key) => !(key in value))) throw new Error(`${name}_FIELDS_INVALID`);
}
export function validateExecutionJournal(journal) {
  exactAllowed(journal, JOURNAL_FIELDS, [], "EXECUTION_JOURNAL");
  if (journal.schemaVersion !== 1 || journal.evidenceMode !== "OFFLINE_FIXTURE" || !["ACTIVE", "INTEGRATION_PREPARATION", "RECONCILIATION_REQUIRED"].includes(journal.status) || !Array.isArray(journal.executions) || !/^[0-9a-f]{64}$/u.test(journal.executionPolicyDigest) || !/^[0-9a-f]{64}$/u.test(journal.adapterDigest)) throw new Error("EXECUTION_JOURNAL_INVALID");
  for (const record of journal.executions) {
    exactAllowed(record, EXECUTION_FIELDS, ["timing", "failure"], "EXECUTION_RECORD");
    if (record.schemaVersion !== 1 || !EXECUTION_STATES.includes(record.status) || !/^[0-9a-f]{64}$/u.test(record.taskDigest) || !/^[0-9a-f]{64}$/u.test(record.adapterDigest) || !/^[0-9a-f]{64}$/u.test(record.executionPolicyDigest) || !/^\d+$/u.test(record.monotonicStartedNs) || (record.activeNs !== null && !/^\d+$/u.test(record.activeNs)) || !Array.isArray(record.transitions) || record.transitions.length === 0 || record.transitions.at(-1)?.status !== record.status) throw new Error("EXECUTION_RECORD_INVALID");
  }
  return true;
}

export function controllerReleaseIdentity(root) {
  const metadata = commitMetadata(root, "HEAD"); return { root: fs.realpathSync(root), commit: metadata.commit, tree: metadata.tree };
}

export function initializeExecutionJournal(filePath, metadata) {
  if (fs.existsSync(filePath)) { const existing = JSON.parse(fs.readFileSync(filePath, "utf8")); validateExecutionJournal(existing); return existing; }
  const state = { schemaVersion: 1, runId: metadata.runId, evidenceMode: "OFFLINE_FIXTURE", scenario: metadata.scenario, controller: metadata.controller, authorization: metadata.authorization, executionPolicyDigest: metadata.executionPolicyDigest, adapterVersion: metadata.adapterVersion, adapterDigest: metadata.adapterDigest, status: "ACTIVE", executions: [], createdAt: metadata.createdAt, updatedAt: metadata.createdAt };
  validateExecutionJournal(state); replaceStateAtomic(filePath, state); return state;
}

function mutateJournal(filePath, mutate) {
  const lock = acquireLock(`${filePath}.lock`, { controllerId: "offline-autopilot", generation: 1, pid: process.pid });
  if (!lock.acquired) throw Object.assign(new Error("OFFLINE_EXECUTION_JOURNAL_LOCKED"), { code: "OFFLINE_EXECUTION_JOURNAL_LOCKED" });
  try { const state = JSON.parse(fs.readFileSync(filePath, "utf8")); validateExecutionJournal(state); const next = mutate(structuredClone(state)); validateExecutionJournal(next); replaceStateAtomic(filePath, next); return next; } finally { lock.release(); }
}

function transition(filePath, executionId, status, now, additions = {}) {
  return mutateJournal(filePath, (journal) => {
    const record = journal.executions.find((item) => item.executionId === executionId); if (!record) throw new Error("EXECUTION_RECORD_NOT_FOUND");
    const allowed = { PREPARING: ["CONFINEMENT_VERIFIED", "EXECUTING", "ABORTED", "RECONCILIATION_REQUIRED"], CONFINEMENT_VERIFIED: ["EXECUTING", "ABORTED", "RECONCILIATION_REQUIRED"], EXECUTING: ["RESULT_CAPTURED", "ABORTED", "RECONCILIATION_REQUIRED"], RESULT_CAPTURED: ["EXECUTION_FINISHED", "RECONCILIATION_REQUIRED"], EXECUTION_FINISHED: ["SUBMITTED", "RECONCILIATION_REQUIRED"], SUBMITTED: [], ABORTED: [], RECONCILIATION_REQUIRED: [] };
    if (!allowed[record.status].includes(status)) throw new Error(`EXECUTION_TRANSITION_INVALID:${record.status}:${status}`);
    record.status = status; Object.assign(record, structuredClone(additions)); record.transitions.push({ status, at: now }); journal.updatedAt = now; if (status === "RECONCILIATION_REQUIRED") journal.status = status; return journal;
  });
}

function beginExecution({ journalPath, task, workspace, metadata, now }) {
  const executionId = `execution:${crypto.randomUUID()}`;
  mutateJournal(journalPath, (journal) => {
    const unresolved = journal.executions.find((item) => item.taskDigest === task.taskDigest && !["SUBMITTED", "ABORTED"].includes(item.status));
    if (unresolved) throw new Error("EXECUTION_ALREADY_ACTIVE_OR_UNCERTAIN");
    journal.executions.push({ schemaVersion: 1, executionId, taskId: task.taskId, taskDigest: task.taskDigest, cycleId: task.cycleId, role: task.role, purpose: task.purpose, iteration: task.iteration, planRevision: task.planRevision, controller: metadata.controller, authorization: metadata.authorization, adapterVersion: metadata.adapterVersion, adapterDigest: metadata.adapterDigest, executionPolicyDigest: metadata.executionPolicyDigest, workspaceIdentity: workspace ?? null, executableIdentity: null, confinementEvidence: null, monotonicStartedNs: process.hrtime.bigint().toString(), activeNs: null, toolRequestDigest: null, toolResultDigest: null, candidateEvidence: null, result: null, resultDigest: null, submissionReceipt: null, receiptDigest: null, status: "PREPARING", transitions: [{ status: "PREPARING", at: now }] }); journal.updatedAt = now; return journal;
  });
  return executionId;
}

function launchBuilderExecutor({ task, executionId, workspaceRoot, toolFrame, controllerRoot, boundary }) {
  const input = encodeExecutionFrame(toolFrame);
  const env = {
    PATH: "/usr/bin:/bin:/usr/local/bin", HOME: workspaceRoot, TMPDIR: path.join(workspaceRoot, ".tmp"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false", GIT_SSH_COMMAND: "/usr/bin/false", GIT_NO_LAZY_FETCH: "1",
    OFFLINE_WORKSPACE_ROOT: workspaceRoot, OFFLINE_AUTHORITY_ROOT: boundary.roots.authorityRoot.canonicalRoot, OFFLINE_CONTROLLER_ROOT: boundary.roots.controllerRoot.canonicalRoot, OFFLINE_TARGET_ROOT: boundary.roots.targetRoot.canonicalRoot, OFFLINE_POLICY_DIGEST: boundary.digest,
  };
  fs.mkdirSync(env.TMPDIR, { recursive: true, mode: 0o700 });
  const script = path.join(controllerRoot, "src/offline-builder-executor.mjs");
  const child = spawnSync("/usr/bin/sandbox-exec", ["-p", boundary.profile, "/usr/local/bin/node", script], { cwd: controllerRoot, env, input, encoding: null, maxBuffer: 2 * 1024 * 1024 });
  if (child.error) throw child.error;
  let frame = null; try { frame = decodeExecutionFrame(child.stdout, { executionId, taskDigest: task.taskDigest, expectedSequence: 1, allowedTypes: EXECUTOR_EVENT_TYPES }); } catch {}
  if (child.status !== 0) throw new Error(`OFFLINE_BUILDER_EXECUTOR_FAILED:${child.status}:${frame?.payload?.code ?? child.stderr.toString("utf8").trim()}:${frame?.payload?.message ?? ""}`);
  if (!frame) throw new Error("OFFLINE_BUILDER_EXECUTOR_FRAME_MISSING");
  if (frame.type !== "tool_result") throw new Error(`OFFLINE_BUILDER_EXECUTOR_${frame.type.toUpperCase()}`);
  if (frame.payload.confinement?.policyDigest !== boundary.digest || frame.payload.confinement?.protectedPathMutationAttempts !== 0) throw new Error("OFFLINE_BUILDER_CONFINEMENT_MISMATCH");
  const normalized = createExecutionFrame({ executionId, taskDigest: task.taskDigest, sequence: 1, type: "tool_result", allowedTypes: EXECUTOR_EVENT_TYPES, payload: { ...frame.payload, confinement: { ...frame.payload.confinement, roots: boundary.roots } } });
  return { frame: normalized, boundary };
}

function updateExecution(filePath, executionId, now, additions) {
  return mutateJournal(filePath, (journal) => {
    const record = journal.executions.find((item) => item.executionId === executionId); if (!record) throw new Error("EXECUTION_RECORD_NOT_FOUND");
    if (record.status !== "EXECUTING") throw new Error(`EXECUTION_UPDATE_INVALID:${record.status}`);
    Object.assign(record, structuredClone(additions)); journal.updatedAt = now; return journal;
  });
}

function nowAfter(now, milliseconds = 1) { return new Date(Date.parse(now) + milliseconds).toISOString(); }

export function executeBoundRole({ statePath, journalPath, task, transport, runtimeRoot, controllerRoot, metadata, now = new Date().toISOString(), inject = null }) {
  const state = readState(statePath); if (state.pendingTaskId !== task.taskId || state.evidenceMode !== "OFFLINE_FIXTURE") throw new Error("OFFLINE_PENDING_TASK_MISMATCH");
  const workspace = state.workspaces.find((item) => item.taskId === task.taskId) ?? null; const executionId = beginExecution({ journalPath, task, workspace, metadata, now });
  if (inject === "before-execution") throw Object.assign(new Error("INJECTED_CRASH_BEFORE_EXECUTION"), { code: "INJECTED_CRASH_BEFORE_EXECUTION" });
  const startedAt = nowAfter(now); startRole({ statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, taskId: task.taskId, now: startedAt });
  if (task.purpose !== "BUILDER_IMPLEMENTATION") transition(journalPath, executionId, "EXECUTING", startedAt);
  let builderToolStarted = false;
  try {
    const context = { executionId, evidenceMode: "OFFLINE_FIXTURE" };
    let precomputedValidation = [];
    if (task.purpose === "ANALYST_REVIEW") { precomputedValidation = executedValidationEntries(readState(statePath), task, executionId); context.validation = precomputedValidation; }
    let frame = transport.execute(task, task.previousEvidence, context); validateExecutionFrame(frame, { executionId, taskDigest: task.taskDigest, expectedSequence: 0 });
    if (frame.type === "transport_failure") throw new Error(`OFFLINE_TRANSPORT_FAILURE:${frame.payload.code}`);
    let checkpoint = null; let validation = [];
    if (frame.type === "tool_request") {
      if (task.purpose !== "BUILDER_IMPLEMENTATION" || !workspace) throw new Error("OFFLINE_TOOL_REQUEST_NOT_ALLOWED");
      builderToolStarted = true;
      const boundary = offlineExecutorSandboxProfile({ workspaceRoot: workspace.root });
      transition(journalPath, executionId, "CONFINEMENT_VERIFIED", nowAfter(startedAt), { confinementEvidence: { mechanism: "MACOS_SANDBOX_EXEC", policyDigest: boundary.digest, roots: boundary.roots, actualProcessEvidencePending: true, protectedPathMutationAttempts: 0 }, toolRequestDigest: frame.frameDigest });
      transition(journalPath, executionId, "EXECUTING", nowAfter(startedAt, 2));
      if (inject === "during-builder") throw Object.assign(new Error("INJECTED_CRASH_DURING_BUILDER"), { code: "INJECTED_CRASH_DURING_BUILDER" });
      const launched = launchBuilderExecutor({ task, executionId, workspaceRoot: workspace.root, toolFrame: frame, controllerRoot, boundary });
      updateExecution(journalPath, executionId, nowAfter(startedAt, 3), { confinementEvidence: launched.frame.payload.confinement, executableIdentity: launched.frame.payload.executableIdentity, toolResultDigest: launched.frame.frameDigest });
      checkpoint = createLocalCheckpoint({ statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, taskId: task.taskId, now: nowAfter(startedAt, 4) }).receipt;
      validation = executedValidationEntries(readState(statePath), task, executionId);
      frame = transport.execute(task, task.previousEvidence, { ...context, toolResult: launched.frame.payload, checkpoint, validation }); validateExecutionFrame(frame, { executionId, taskDigest: task.taskDigest, expectedSequence: 1 });
    } else if (task.purpose === "ANALYST_REVIEW") validation = precomputedValidation;
    if (frame.type !== "role_result") throw new Error("OFFLINE_ROLE_RESULT_REQUIRED");
    const result = frame.payload; const resultDigest = sha256Canonical(result); const capturedAt = nowAfter(startedAt, 5);
    transition(journalPath, executionId, "RESULT_CAPTURED", capturedAt, { result, resultDigest, candidateEvidence: checkpoint });
    if (inject === "after-capture") throw Object.assign(new Error("INJECTED_CRASH_AFTER_CAPTURE"), { code: "INJECTED_CRASH_AFTER_CAPTURE" });
    const finishedAt = nowAfter(startedAt, 6); const timing = finishRole({ statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, taskId: task.taskId, now: finishedAt }).value;
    const startedNs = BigInt(JSON.parse(fs.readFileSync(journalPath, "utf8")).executions.find((item) => item.executionId === executionId).monotonicStartedNs); const activeNs = (process.hrtime.bigint() - startedNs).toString();
    transition(journalPath, executionId, "EXECUTION_FINISHED", finishedAt, { activeNs, timing });
    let submitted;
    try { submitted = submitRoleResult({ statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, result, now: nowAfter(finishedAt), persistenceOptions: inject === "uncertain-submission" ? { failAfterRename: true } : {} }).value; }
    catch (error) { if (error.code === "PERSISTENCE_DURABILITY_UNCERTAIN") { transition(journalPath, executionId, "RECONCILIATION_REQUIRED", nowAfter(finishedAt), { failure: error.code }); } throw error; }
    const receiptDigest = sha256Canonical(submitted); transition(journalPath, executionId, "SUBMITTED", nowAfter(finishedAt, 2), { submissionReceipt: submitted, receiptDigest });
    return { executionId, result, resultDigest, receipt: submitted, receiptDigest, validation, checkpoint };
  } catch (error) {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")); const record = journal.executions.find((item) => item.executionId === executionId);
    if (record && !["SUBMITTED", "ABORTED", "RECONCILIATION_REQUIRED"].includes(record.status) && !String(error.code ?? error.message).startsWith("INJECTED_CRASH")) {
      const uncertain = task.purpose === "BUILDER_IMPLEMENTATION" && builderToolStarted;
      transition(journalPath, executionId, uncertain ? "RECONCILIATION_REQUIRED" : "ABORTED", new Date().toISOString(), { failure: error.code ?? error.message });
    }
    throw error;
  }
}

export function reconcileExecutionJournal({ journalPath, statePath, now = new Date().toISOString() }) {
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")); validateExecutionJournal(journal); const controller = readState(statePath); const actions = [];
  for (const record of journal.executions.filter((item) => !["SUBMITTED", "ABORTED", "RECONCILIATION_REQUIRED"].includes(item.status))) {
    const receipt = controller.receipts.find((item) => item.taskDigest === record.taskDigest);
    if (receipt && record.resultDigest && receipt.resultDigest === record.resultDigest) { transition(journalPath, record.executionId, "SUBMITTED", now, { submissionReceipt: receipt, receiptDigest: sha256Canonical(receipt) }); actions.push({ executionId: record.executionId, action: "CONFIRMED_SUBMITTED" }); continue; }
    if (record.status === "PREPARING") { transition(journalPath, record.executionId, "ABORTED", now, { failure: "RECOVERED_BEFORE_EXECUTION" }); actions.push({ executionId: record.executionId, action: "ABORTED_SAFE_RETRY" }); continue; }
    transition(journalPath, record.executionId, "RECONCILIATION_REQUIRED", now, { failure: "RECOVERY_UNCERTAIN" }); actions.push({ executionId: record.executionId, action: "RECONCILIATION_REQUIRED" });
  }
  return actions;
}
