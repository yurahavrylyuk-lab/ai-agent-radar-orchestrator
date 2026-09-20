import { CYCLE_STATES, REVIEW_STATES } from "./contracts.mjs";

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}
function exact(value, allowed, name) {
  object(value, name);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${name} has unknown field: ${unknown[0]}`);
}
function string(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
}
function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be an integer >= ${minimum}`);
}

export function validateRequest(value) {
  exact(value, ["id", "source", "createdAt", "priority", "scheduledFor", "payload"], "request");
  string(value.id, "request.id");
  if (!["HUMAN", "SCHEDULED"].includes(value.source)) throw new TypeError("request.source is invalid");
  string(value.createdAt, "request.createdAt");
  integer(value.priority, "request.priority");
  if (value.scheduledFor !== undefined) string(value.scheduledFor, "request.scheduledFor");
  object(value.payload, "request.payload");
  return true;
}
export function validateCycle(value) {
  exact(value, ["id", "requestId", "status", "planRevision", "baseline", "iterationIds", "activeMs", "humanWaitingMs", "liveOperationsEnabled"], "cycle");
  string(value.id, "cycle.id"); string(value.requestId, "cycle.requestId");
  if (!CYCLE_STATES.includes(value.status)) throw new TypeError("cycle.status is invalid");
  integer(value.planRevision, "cycle.planRevision", 1); string(value.baseline, "cycle.baseline");
  if (!Array.isArray(value.iterationIds) || !value.iterationIds.every((item) => typeof item === "string")) throw new TypeError("cycle.iterationIds is invalid");
  integer(value.activeMs, "cycle.activeMs"); integer(value.humanWaitingMs, "cycle.humanWaitingMs");
  if (value.liveOperationsEnabled !== false) throw new TypeError("live operations must be disabled");
  return true;
}
export function validateIteration(value) {
  exact(value, ["id", "cycleId", "index", "planRevision", "builderCommit", "reviewState", "createdAt"], "iteration");
  string(value.id, "iteration.id"); string(value.cycleId, "iteration.cycleId"); integer(value.index, "iteration.index", 1);
  integer(value.planRevision, "iteration.planRevision", 1); string(value.builderCommit, "iteration.builderCommit");
  if (!REVIEW_STATES.includes(value.reviewState)) throw new TypeError("iteration.reviewState is invalid");
  string(value.createdAt, "iteration.createdAt"); return true;
}
export function validateMachineState(value) {
  exact(value, ["schemaVersion", "controllerId", "stateVersion", "owner", "activeCycleId", "humanHold", "queue"], "machineState");
  integer(value.schemaVersion, "machineState.schemaVersion", 1); string(value.controllerId, "machineState.controllerId");
  integer(value.stateVersion, "machineState.stateVersion"); exact(value.owner, ["id", "generation"], "owner");
  string(value.owner.id, "owner.id"); integer(value.owner.generation, "owner.generation", 1);
  if (value.activeCycleId !== null) string(value.activeCycleId, "machineState.activeCycleId");
  if (typeof value.humanHold !== "boolean") throw new TypeError("machineState.humanHold must be boolean");
  if (!Array.isArray(value.queue)) throw new TypeError("machineState.queue must be an array");
  value.queue.forEach(validateRequest); return true;
}
export function validateNotification(value) {
  exact(value, ["eventId", "payloadHash", "status", "createdAt"], "notification");
  string(value.eventId, "notification.eventId"); string(value.payloadHash, "notification.payloadHash");
  if (!["PENDING", "SENT", "FAILED"].includes(value.status)) throw new TypeError("notification.status is invalid");
  string(value.createdAt, "notification.createdAt"); return true;
}
export function validateRoleResult(value) {
  exact(value, ["role", "status", "model", "startedAt", "finishedAt", "activeMs", "simulated"], "roleResult");
  if (!["architect", "builder", "analyst"].includes(value.role)) throw new TypeError("roleResult.role is invalid");
  string(value.status, "roleResult.status"); string(value.model, "roleResult.model"); string(value.startedAt, "roleResult.startedAt");
  if (value.finishedAt !== null) string(value.finishedAt, "roleResult.finishedAt"); integer(value.activeMs, "roleResult.activeMs");
  if (value.simulated !== true) throw new TypeError("roleResult must be labeled simulated"); return true;
}
export function validateSummary(value) {
  exact(value, ["cycleId", "status", "iterationCount", "message", "createdAt", "simulated"], "summary");
  string(value.cycleId, "summary.cycleId"); if (!CYCLE_STATES.includes(value.status)) throw new TypeError("summary.status is invalid");
  integer(value.iterationCount, "summary.iterationCount"); string(value.message, "summary.message"); string(value.createdAt, "summary.createdAt");
  if (value.simulated !== true) throw new TypeError("summary must be labeled simulated"); return true;
}
export function validateCrossRecords({ cycle, iterations = [], summary }) {
  validateCycle(cycle); iterations.forEach(validateIteration);
  if (iterations.some((item) => item.cycleId !== cycle.id || item.planRevision !== cycle.planRevision)) throw new TypeError("iteration/cycle mismatch");
  if (new Set(iterations.map((item) => item.id)).size !== iterations.length) throw new TypeError("duplicate iteration id");
  if (summary) { validateSummary(summary); if (summary.cycleId !== cycle.id || summary.iterationCount !== iterations.length) throw new TypeError("summary/cycle mismatch"); }
  return true;
}
export const validators = Object.freeze({ request: validateRequest, cycle: validateCycle, iteration: validateIteration, machineState: validateMachineState, notification: validateNotification, roleResult: validateRoleResult, summary: validateSummary });
