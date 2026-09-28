import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PHASE2, sha256Canonical } from "./contracts.mjs";
import { commitMetadata } from "./git-evidence.mjs";
import { acquireLock, readState, replaceStateAtomic } from "./local-store.mjs";
import { createLocalCheckpoint } from "./local-checkpoint.mjs";
import { offlineExecutorSandboxProfile } from "./operator-boundary.mjs";
import { createExecutionFrame, decodeExecutionFrame, encodeExecutionFrame, EXECUTOR_EVENT_TYPES, validateExecutionFrame } from "./role-execution-protocol.mjs";
import { activeCycleExecutionMs, finishRoleMeasured, interruptRoleMeasured, startRole } from "./role-timing.mjs";
import { submitRoleResult } from "./result-submission.mjs";
import { executedValidationEntries } from "./validation-evidence.mjs";

export const EXECUTION_STATES = Object.freeze(["PREPARING", "CONFINEMENT_VERIFIED", "EXECUTING", "RESULT_CAPTURED", "EXECUTION_FINISHED", "SUBMITTED", "ABORTED"]);
const JOURNAL_FIELDS = ["schemaVersion", "runId", "evidenceMode", "scenario", "controller", "authorization", "executionPolicyDigest", "adapterVersion", "adapterDigest", "status", "failure", "executions", "createdAt", "updatedAt"];
const EXECUTION_FIELDS = ["schemaVersion", "executionId", "taskId", "taskDigest", "cycleId", "role", "purpose", "iteration", "planRevision", "controller", "authorization", "adapterVersion", "adapterDigest", "executionPolicyDigest", "workspaceIdentity", "executableIdentity", "confinementEvidence", "monotonicStartedNs", "activeNs", "toolRequestDigest", "toolResultDigest", "candidateEvidence", "result", "resultDigest", "submissionReceipt", "receiptDigest", "status", "transitions"];

const TEST_CONTROL = Symbol("offline-execution-test-control");
function realClock() { return Object.freeze({ monotonicNs: () => process.hrtime.bigint(), wallNow: () => new Date().toISOString() }); }
export function createOfflineExecutionTestControl({ wallNow = "2026-09-28T08:00:00.000Z", roleLimitMs = PHASE2.maxExecutionSeconds * 1000, cycleLimitMs = PHASE2.maxCycleExecutionSeconds * 1000, advances = {}, builderDelayMs = 0 } = {}) {
  let monotonic = 0n; let wall = Date.parse(wallNow); const queues = new Map(Object.entries(advances).map(([name, values]) => [name, Array.isArray(values) ? [...values] : [values]]));
  const clock = Object.freeze({ monotonicNs: () => monotonic, wallNow: () => new Date(wall).toISOString(), advance(milliseconds) { if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error("TEST_CLOCK_ADVANCE_INVALID"); monotonic += BigInt(milliseconds) * 1_000_000n; wall += milliseconds; } });
  return Object.freeze({ [TEST_CONTROL]: true, clock, roleLimitMs, cycleLimitMs, builderDelayMs, checkpoint(name) { const queue = queues.get(name); if (queue?.length) clock.advance(queue.shift()); } });
}
function resolveControl(value) {
  if (value === null || value === undefined) return Object.freeze({ clock: realClock(), roleLimitMs: PHASE2.maxExecutionSeconds * 1000, cycleLimitMs: PHASE2.maxCycleExecutionSeconds * 1000, builderDelayMs: 0 });
  if (value[TEST_CONTROL] !== true) throw new Error("OFFLINE_EXECUTION_CONTROL_TEST_ONLY"); return value;
}
function exactAllowed(value, required, optional, name) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}_INVALID`); const allowed = new Set([...required, ...optional]); if (Object.keys(value).some((key) => !allowed.has(key)) || required.some((key) => !(key in value))) throw new Error(`${name}_FIELDS_INVALID`); }
export function validateExecutionJournal(journal) {
  exactAllowed(journal, JOURNAL_FIELDS, [], "EXECUTION_JOURNAL");
  if (journal.schemaVersion !== 1 || journal.evidenceMode !== "OFFLINE_FIXTURE" || !["ACTIVE", "READY_FOR_INTEGRATION", "FAILED"].includes(journal.status) || !Array.isArray(journal.executions) || !/^[0-9a-f]{64}$/u.test(journal.executionPolicyDigest) || !/^[0-9a-f]{64}$/u.test(journal.adapterDigest) || (journal.status === "FAILED") !== (typeof journal.failure === "string")) throw new Error("EXECUTION_JOURNAL_INVALID");
  for (const record of journal.executions) { exactAllowed(record, EXECUTION_FIELDS, ["timing", "failure"], "EXECUTION_RECORD"); if (record.schemaVersion !== 1 || !EXECUTION_STATES.includes(record.status) || !/^[0-9a-f]{64}$/u.test(record.taskDigest) || !/^[0-9a-f]{64}$/u.test(record.adapterDigest) || !/^[0-9a-f]{64}$/u.test(record.executionPolicyDigest) || !/^\d+$/u.test(record.monotonicStartedNs) || (record.activeNs !== null && !/^\d+$/u.test(record.activeNs)) || !Array.isArray(record.transitions) || record.transitions.length === 0 || record.transitions.at(-1)?.status !== record.status) throw new Error("EXECUTION_RECORD_INVALID"); }
  return true;
}
export function controllerReleaseIdentity(root) { const metadata = commitMetadata(root, "HEAD"); return { root: fs.realpathSync(root), commit: metadata.commit, tree: metadata.tree }; }
export function initializeExecutionJournal(filePath, metadata) {
  if (fs.existsSync(filePath)) throw new Error("OFFLINE_EXECUTION_JOURNAL_ALREADY_EXISTS");
  const state = { schemaVersion: 1, runId: metadata.runId, evidenceMode: "OFFLINE_FIXTURE", scenario: metadata.scenario, controller: metadata.controller, authorization: metadata.authorization, executionPolicyDigest: metadata.executionPolicyDigest, adapterVersion: metadata.adapterVersion, adapterDigest: metadata.adapterDigest, status: "ACTIVE", failure: null, executions: [], createdAt: metadata.createdAt, updatedAt: metadata.createdAt };
  validateExecutionJournal(state); replaceStateAtomic(filePath, state); return state;
}
function mutateJournal(filePath, mutate) {
  const lock = acquireLock(`${filePath}.lock`, { controllerId: "offline-autopilot", generation: 1, pid: process.pid }); if (!lock.acquired) throw Object.assign(new Error("OFFLINE_EXECUTION_JOURNAL_LOCKED"), { code: "OFFLINE_EXECUTION_JOURNAL_LOCKED" });
  try { const state = JSON.parse(fs.readFileSync(filePath, "utf8")); validateExecutionJournal(state); const next = mutate(structuredClone(state)); validateExecutionJournal(next); replaceStateAtomic(filePath, next); return next; } finally { lock.release(); }
}
export function markExecutionJournalReady(filePath, now) { return mutateJournal(filePath, (journal) => { if (journal.status !== "ACTIVE" || journal.executions.some((item) => item.status !== "SUBMITTED")) throw new Error("OFFLINE_JOURNAL_NOT_READY"); journal.status = "READY_FOR_INTEGRATION"; journal.updatedAt = now; return journal; }); }
export function markExecutionJournalFailed(filePath, now, failure) { return mutateJournal(filePath, (journal) => { if (journal.status === "READY_FOR_INTEGRATION") throw new Error("OFFLINE_JOURNAL_ALREADY_READY"); journal.status = "FAILED"; journal.failure = String(failure); journal.updatedAt = now; return journal; }); }
function transition(filePath, executionId, status, now, additions = {}) {
  return mutateJournal(filePath, (journal) => { const record = journal.executions.find((item) => item.executionId === executionId); if (!record) throw new Error("EXECUTION_RECORD_NOT_FOUND"); const allowed = { PREPARING: ["CONFINEMENT_VERIFIED", "EXECUTING", "ABORTED"], CONFINEMENT_VERIFIED: ["EXECUTING", "ABORTED"], EXECUTING: ["RESULT_CAPTURED", "ABORTED"], RESULT_CAPTURED: ["EXECUTION_FINISHED", "ABORTED"], EXECUTION_FINISHED: ["SUBMITTED", "ABORTED"], SUBMITTED: [], ABORTED: [] }; if (!allowed[record.status].includes(status)) throw new Error(`EXECUTION_TRANSITION_INVALID:${record.status}:${status}`); record.status = status; Object.assign(record, structuredClone(additions)); record.transitions.push({ status, at: now }); journal.updatedAt = now; return journal; });
}
function beginExecution({ journalPath, task, workspace, metadata, now, monotonicStartedNs }) {
  const executionId = `execution:${crypto.randomUUID()}`; mutateJournal(journalPath, (journal) => { if (journal.status !== "ACTIVE") throw new Error("OFFLINE_JOURNAL_NOT_ACTIVE"); if (journal.executions.some((item) => item.taskDigest === task.taskDigest)) throw new Error("DUPLICATE_ROLE_EXECUTION"); journal.executions.push({ schemaVersion: 1, executionId, taskId: task.taskId, taskDigest: task.taskDigest, cycleId: task.cycleId, role: task.role, purpose: task.purpose, iteration: task.iteration, planRevision: task.planRevision, controller: metadata.controller, authorization: metadata.authorization, adapterVersion: metadata.adapterVersion, adapterDigest: metadata.adapterDigest, executionPolicyDigest: metadata.executionPolicyDigest, workspaceIdentity: workspace ?? null, executableIdentity: null, confinementEvidence: null, monotonicStartedNs: monotonicStartedNs.toString(), activeNs: null, toolRequestDigest: null, toolResultDigest: null, candidateEvidence: null, result: null, resultDigest: null, submissionReceipt: null, receiptDigest: null, status: "PREPARING", transitions: [{ status: "PREPARING", at: now }] }); journal.updatedAt = now; return journal; }); return executionId;
}
function launchBuilderExecutor({ task, executionId, workspaceRoot, toolFrame, controllerRoot, boundary, timeoutMs, testDelayMs }) {
  const input = encodeExecutionFrame(toolFrame); const env = { PATH: "/usr/bin:/bin:/usr/local/bin", HOME: workspaceRoot, TMPDIR: path.join(workspaceRoot, ".tmp"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false", GIT_SSH_COMMAND: "/usr/bin/false", GIT_NO_LAZY_FETCH: "1", OFFLINE_WORKSPACE_ROOT: workspaceRoot, OFFLINE_AUTHORITY_ROOT: boundary.roots.authorityRoot.canonicalRoot, OFFLINE_CONTROLLER_ROOT: boundary.roots.controllerRoot.canonicalRoot, OFFLINE_TARGET_ROOT: boundary.roots.targetRoot.canonicalRoot, OFFLINE_POLICY_DIGEST: boundary.digest };
  if (testDelayMs > 0) env.OFFLINE_TEST_DELAY_MS = String(testDelayMs); fs.mkdirSync(env.TMPDIR, { recursive: true, mode: 0o700 }); const script = path.join(controllerRoot, "src/offline-builder-executor.mjs");
  const child = spawnSync("/usr/bin/sandbox-exec", ["-p", boundary.profile, "/usr/local/bin/node", script], { cwd: controllerRoot, env, input, encoding: null, maxBuffer: 2 * 1024 * 1024, timeout: Math.max(1, timeoutMs), killSignal: "SIGKILL" });
  if (child.error?.code === "ETIMEDOUT") throw Object.assign(new Error("OFFLINE_ROLE_DEADLINE_EXCEEDED"), { code: "OFFLINE_ROLE_DEADLINE_EXCEEDED" }); if (child.error) throw child.error;
  let frame = null; try { frame = decodeExecutionFrame(child.stdout, { executionId, taskDigest: task.taskDigest, expectedSequence: 1, allowedTypes: EXECUTOR_EVENT_TYPES }); } catch {}
  if (child.status !== 0) throw new Error(`OFFLINE_BUILDER_EXECUTOR_FAILED:${child.status}:${frame?.payload?.code ?? child.stderr.toString("utf8").trim()}:${frame?.payload?.message ?? ""}`); if (!frame) throw new Error("OFFLINE_BUILDER_EXECUTOR_FRAME_MISSING"); if (frame.type !== "tool_result") throw new Error(`OFFLINE_BUILDER_EXECUTOR_${frame.type.toUpperCase()}`);
  if (frame.payload.confinement?.policyDigest !== boundary.digest || frame.payload.confinement?.protectedPathMutationAttempts !== 0) throw new Error("OFFLINE_BUILDER_CONFINEMENT_MISMATCH");
  return createExecutionFrame({ executionId, taskDigest: task.taskDigest, sequence: 1, type: "tool_result", allowedTypes: EXECUTOR_EVENT_TYPES, payload: { ...frame.payload, confinement: { ...frame.payload.confinement, roots: boundary.roots } } });
}
function elapsedMs(control, startedNs) { return Number((control.clock.monotonicNs() - startedNs) / 1_000_000n); }
function deadlineFor(state, task, control) { const remaining = control.cycleLimitMs - activeCycleExecutionMs(state, task.cycleId); if (remaining <= 0) throw Object.assign(new Error("OFFLINE_CYCLE_BUDGET_EXCEEDED"), { code: "OFFLINE_CYCLE_BUDGET_EXCEEDED" }); return Math.min(control.roleLimitMs, remaining); }
function assertDeadline(control, startedNs, deadlineMs) { if (elapsedMs(control, startedNs) > deadlineMs) throw Object.assign(new Error("OFFLINE_ROLE_DEADLINE_EXCEEDED"), { code: "OFFLINE_ROLE_DEADLINE_EXCEEDED" }); }

export function executeBoundRole({ statePath, journalPath, task, transport, controllerRoot, metadata, executionControl: suppliedControl = null, onPhase = () => {} }) {
  const control = resolveControl(suppliedControl); const startedNs = control.clock.monotonicNs(); const startedAt = control.clock.wallNow(); const state = readState(statePath);
  if (state.pendingTaskId !== task.taskId || state.evidenceMode !== "OFFLINE_FIXTURE") throw new Error("OFFLINE_PENDING_TASK_MISMATCH"); const deadlineMs = deadlineFor(state, task, control); const workspace = state.workspaces.find((item) => item.taskId === task.taskId) ?? null; const executionId = beginExecution({ journalPath, task, workspace, metadata, now: startedAt, monotonicStartedNs: startedNs });
  startRole({ statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, taskId: task.taskId, now: startedAt }); if (task.purpose !== "BUILDER_IMPLEMENTATION") transition(journalPath, executionId, "EXECUTING", startedAt);
  let timingFinished = false;
  try {
    const context = { executionId, evidenceMode: "OFFLINE_FIXTURE" }; let validation = [];
    if (task.purpose === "ANALYST_REVIEW") { validation = executedValidationEntries(readState(statePath), task, executionId); context.validation = validation; }
    let frame = transport.execute(task, task.previousEvidence, context); control.checkpoint?.("after-transport"); assertDeadline(control, startedNs, deadlineMs); validateExecutionFrame(frame, { executionId, taskDigest: task.taskDigest, expectedSequence: 0 }); if (frame.type === "transport_failure") throw new Error(`OFFLINE_TRANSPORT_FAILURE:${frame.payload.code}`);
    let checkpoint = null;
    if (frame.type === "tool_request") {
      if (task.purpose !== "BUILDER_IMPLEMENTATION" || !workspace) throw new Error("OFFLINE_TOOL_REQUEST_NOT_ALLOWED"); const boundary = offlineExecutorSandboxProfile({ workspaceRoot: workspace.root });
      const launched = launchBuilderExecutor({ task, executionId, workspaceRoot: workspace.root, toolFrame: frame, controllerRoot, boundary, timeoutMs: deadlineMs - elapsedMs(control, startedNs), testDelayMs: control.builderDelayMs }); control.checkpoint?.("after-builder"); assertDeadline(control, startedNs, deadlineMs);
      transition(journalPath, executionId, "CONFINEMENT_VERIFIED", control.clock.wallNow(), { confinementEvidence: launched.payload.confinement, executableIdentity: launched.payload.executableIdentity, toolRequestDigest: frame.frameDigest, toolResultDigest: launched.frameDigest }); transition(journalPath, executionId, "EXECUTING", control.clock.wallNow());
      checkpoint = createLocalCheckpoint({ statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, taskId: task.taskId, now: control.clock.wallNow() }).receipt; onPhase("VALIDATING"); validation = executedValidationEntries(readState(statePath), task, executionId);
      frame = transport.execute(task, task.previousEvidence, { ...context, toolResult: launched.payload, checkpoint, validation }); control.checkpoint?.("after-transport"); assertDeadline(control, startedNs, deadlineMs); validateExecutionFrame(frame, { executionId, taskDigest: task.taskDigest, expectedSequence: 1 });
    }
    if (frame.type !== "role_result") throw new Error("OFFLINE_ROLE_RESULT_REQUIRED"); const result = frame.payload; const resultDigest = sha256Canonical(result); transition(journalPath, executionId, "RESULT_CAPTURED", control.clock.wallNow(), { result, resultDigest, candidateEvidence: checkpoint });
    assertDeadline(control, startedNs, deadlineMs); const measuredMs = elapsedMs(control, startedNs); const timing = finishRoleMeasured({ statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, taskId: task.taskId, now: control.clock.wallNow(), activeMs: measuredMs }).value; timingFinished = true; const activeNs = (BigInt(measuredMs) * 1_000_000n).toString(); transition(journalPath, executionId, "EXECUTION_FINISHED", control.clock.wallNow(), { activeNs, timing });
    const submitted = submitRoleResult({ statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, result, now: control.clock.wallNow() }).value; const receiptDigest = sha256Canonical(submitted); transition(journalPath, executionId, "SUBMITTED", control.clock.wallNow(), { submissionReceipt: submitted, receiptDigest }); return { executionId, result, resultDigest, receipt: submitted, receiptDigest, validation, checkpoint };
  } catch (error) {
    if (!timingFinished) { const current = readState(statePath); if (current.timings.some((item) => item.taskId === task.taskId && item.status === "EXECUTING")) interruptRoleMeasured({ statePath, ownerId: state.owner.id, ownerGeneration: state.owner.generation, taskId: task.taskId, now: control.clock.wallNow(), activeMs: elapsedMs(control, startedNs) }); }
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")); const record = journal.executions.find((item) => item.executionId === executionId); if (record && !["SUBMITTED", "ABORTED"].includes(record.status)) transition(journalPath, executionId, "ABORTED", control.clock.wallNow(), { failure: error.code ?? error.message, activeNs: (BigInt(elapsedMs(control, startedNs)) * 1_000_000n).toString() }); throw error;
  }
}
