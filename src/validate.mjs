import { CYCLE_STATES, PHASE2, REVIEW_STATES, sha256Canonical } from "./contracts.mjs";
import { validateRequiredValidationEvidence } from "./validation-evidence.mjs";

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
function timestamp(value, name) {
  string(value, name);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be a valid timestamp`);
}

export function validateRequest(value) {
  exact(value, ["id", "source", "createdAt", "priority", "scheduledFor", "payload"], "request");
  string(value.id, "request.id");
  if (!["HUMAN", "SCHEDULED"].includes(value.source)) throw new TypeError("request.source is invalid");
  timestamp(value.createdAt, "request.createdAt");
  integer(value.priority, "request.priority");
  if (value.source === "SCHEDULED" && value.scheduledFor === undefined) throw new TypeError("scheduled request requires scheduledFor");
  if (value.scheduledFor !== undefined) timestamp(value.scheduledFor, "request.scheduledFor");
  object(value.payload, "request.payload");
  return true;
}
export function validateCycle(value) {
  exact(value, ["id", "requestId", "status", "planRevision", "baseline", "iterationIds", "activeMs", "humanWaitingMs", "liveOperationsEnabled"], "cycle");
  string(value.id, "cycle.id"); string(value.requestId, "cycle.requestId");
  if (!CYCLE_STATES.includes(value.status)) throw new TypeError("cycle.status is invalid");
  integer(value.planRevision, "cycle.planRevision", 1); string(value.baseline, "cycle.baseline");
  if (!Array.isArray(value.iterationIds) || !value.iterationIds.every((item) => typeof item === "string" && item.length > 0)) throw new TypeError("cycle.iterationIds is invalid");
  if (value.iterationIds.length > 3) throw new TypeError("cycle cannot contain more than three iterations");
  if (new Set(value.iterationIds).size !== value.iterationIds.length) throw new TypeError("duplicate iteration id");
  integer(value.activeMs, "cycle.activeMs"); integer(value.humanWaitingMs, "cycle.humanWaitingMs");
  if (value.liveOperationsEnabled !== false) throw new TypeError("live operations must be disabled");
  return true;
}
export function validateIteration(value) {
  exact(value, ["id", "cycleId", "index", "planRevision", "builderCommit", "reviewState", "createdAt"], "iteration");
  string(value.id, "iteration.id"); string(value.cycleId, "iteration.cycleId"); integer(value.index, "iteration.index", 1);
  if (value.index > 3) throw new TypeError("iteration.index must be <= 3");
  integer(value.planRevision, "iteration.planRevision", 1); string(value.builderCommit, "iteration.builderCommit");
  if (!REVIEW_STATES.includes(value.reviewState)) throw new TypeError("iteration.reviewState is invalid");
  string(value.createdAt, "iteration.createdAt"); return true;
}
export function validateMachineState(value) {
  exact(value, ["schemaVersion", "controllerId", "stateVersion", "owner", "activeCycleId", "humanHold", "queue", "cycles"], "machineState");
  integer(value.schemaVersion, "machineState.schemaVersion", 1); string(value.controllerId, "machineState.controllerId");
  integer(value.stateVersion, "machineState.stateVersion"); exact(value.owner, ["id", "generation"], "owner");
  string(value.owner.id, "owner.id"); integer(value.owner.generation, "owner.generation", 1);
  if (value.activeCycleId !== null) string(value.activeCycleId, "machineState.activeCycleId");
  if (typeof value.humanHold !== "boolean") throw new TypeError("machineState.humanHold must be boolean");
  if (!Array.isArray(value.queue)) throw new TypeError("machineState.queue must be an array");
  value.queue.forEach(validateRequest);
  if (new Set(value.queue.map((request) => request.id)).size !== value.queue.length) throw new TypeError("duplicate queued request id");
  if (!Array.isArray(value.cycles)) throw new TypeError("machineState.cycles must be an array");
  value.cycles.forEach(validateCycle);
  if (new Set(value.cycles.map((cycle) => cycle.id)).size !== value.cycles.length) throw new TypeError("duplicate cycle id");
  if (new Set(value.cycles.map((cycle) => cycle.requestId)).size !== value.cycles.length) throw new TypeError("duplicate claimed request id");
  const claimed = new Set(value.cycles.map((cycle) => cycle.requestId));
  if (value.queue.some((request) => claimed.has(request.id))) throw new TypeError("claimed request remains queued");
  const nonterminalCycles = value.cycles.filter((cycle) => !["ACCEPTED", "REJECTED", "ESCALATED", "HALTED"].includes(cycle.status));
  if (value.activeCycleId === null && nonterminalCycles.length !== 0) throw new TypeError("nonterminal cycle requires activeCycleId");
  if (value.activeCycleId !== null && (nonterminalCycles.length !== 1 || nonterminalCycles[0].id !== value.activeCycleId)) throw new TypeError("activeCycleId must reference the single nonterminal cycle");
  return true;
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
  validateCycle(cycle);
  if (!Array.isArray(iterations) || iterations.length > 3) throw new TypeError("cannot contain more than three iteration records");
  iterations.forEach(validateIteration);
  if (iterations.some((item) => item.cycleId !== cycle.id || item.planRevision !== cycle.planRevision)) throw new TypeError("iteration/cycle mismatch");
  if (new Set(iterations.map((item) => item.id)).size !== iterations.length) throw new TypeError("duplicate iteration id");
  if (new Set(iterations.map((item) => item.index)).size !== iterations.length) throw new TypeError("duplicate iteration index");
  const recordIds = new Set(iterations.map((item) => item.id));
  if (cycle.iterationIds.length !== iterations.length || cycle.iterationIds.some((id) => !recordIds.has(id))) throw new TypeError("cycle iterationIds mismatch");
  const orderedIndices = iterations.map((item) => item.index).sort((a, b) => a - b);
  if (orderedIndices.some((index, offset) => index !== offset + 1)) throw new TypeError("iteration indices must be contiguous from 1");
  if (summary) { validateSummary(summary); if (summary.cycleId !== cycle.id || summary.iterationCount !== iterations.length) throw new TypeError("summary/cycle mismatch"); }
  return true;
}
export const validators = Object.freeze({ request: validateRequest, cycle: validateCycle, iteration: validateIteration, machineState: validateMachineState, notification: validateNotification, roleResult: validateRoleResult, summary: validateSummary });

const ROLES = ["architect", "builder", "analyst"];
const PURPOSES = ["ARCHITECT_PLAN", "ARCHITECT_REVISION", "BUILDER_IMPLEMENTATION", "ANALYST_REVIEW", "ARCHITECT_FINAL_DECISION"];
const EVIDENCE_MODES = ["SIMULATED", "HUMAN_ASSISTED"];
const ANALYST_STATES = ["PASS", "PASS_WITH_RECOMMENDATIONS", "REVISE", "REJECT", "HUMAN_REVIEW_REQUIRED"];
const ARCHITECT_DECISIONS = ["ACCEPT", "REVISE", "REJECT", "HUMAN_REVIEW"];
const HEX40 = /^[0-9a-f]{40}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

function oneOf(value, values, name) {
  if (!values.includes(value)) throw new TypeError(`${name} is invalid`);
}
function nullableString(value, name) {
  if (value !== null) string(value, name);
}
function bool(value, name) {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean`);
}
function oid(value, name, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !HEX40.test(value)) throw new TypeError(`${name} must be a full lowercase SHA-1 object id`);
}
function digest(value, name, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !HEX64.test(value)) throw new TypeError(`${name} must be a lowercase SHA-256 digest`);
}
function utcTimestamp(value, name) {
  if (typeof value !== "string" || !RFC3339_UTC.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be an RFC 3339 UTC timestamp`);
}
function strings(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) throw new TypeError(`${name} must contain non-empty strings`);
}
function unique(records, selector, name) {
  const values = records.map(selector);
  if (new Set(values).size !== values.length) throw new TypeError(`${name} contains duplicates`);
}
function exactRecord(value, fields, name) {
  exact(value, fields, name);
  const missing = fields.filter((field) => !(field in value));
  if (missing.length) throw new TypeError(`${name} is missing field: ${missing[0]}`);
}

export function validateBinding(value, name = "binding") {
  const fields = ["ownerId", "ownerGeneration", "issuedStateVersion", "baselineCommit", "iterationBaseCommit", "expectedTargetBranch", "expectedTargetTip", "workspaceId", "candidateCommit", "reviewedCommit"];
  exactRecord(value, fields, name);
  string(value.ownerId, `${name}.ownerId`); integer(value.ownerGeneration, `${name}.ownerGeneration`, 1); integer(value.issuedStateVersion, `${name}.issuedStateVersion`);
  oid(value.baselineCommit, `${name}.baselineCommit`); oid(value.iterationBaseCommit, `${name}.iterationBaseCommit`);
  string(value.expectedTargetBranch, `${name}.expectedTargetBranch`); oid(value.expectedTargetTip, `${name}.expectedTargetTip`);
  if (value.expectedTargetBranch !== PHASE2.pilotBranch) throw new TypeError(`${name}.expectedTargetBranch must be ${PHASE2.pilotBranch}`);
  nullableString(value.workspaceId, `${name}.workspaceId`); oid(value.candidateCommit, `${name}.candidateCommit`, true); oid(value.reviewedCommit, `${name}.reviewedCommit`, true);
  return true;
}

function validateRule(value, name) {
  exactRecord(value, ["id", "description"], name); string(value.id, `${name}.id`); string(value.description, `${name}.description`);
}
function validateAllowedChange(value, name) {
  exactRecord(value, ["path", "operation"], name); string(value.path, `${name}.path`); oneOf(value.operation, ["ADD", "MODIFY"], `${name}.operation`);
}
export function validateAuthorization(value, name = "authorization") {
  const fields = ["approvalId", "scope", "allowedChanges", "forbiddenChanges", "acceptanceCriteria", "validationRequirements"];
  exactRecord(value, fields, name);
  string(value.approvalId, `${name}.approvalId`); string(value.scope, `${name}.scope`);
  if (!Array.isArray(value.allowedChanges)) throw new TypeError(`${name}.allowedChanges must be an array`);
  value.allowedChanges.forEach((item, index) => validateAllowedChange(item, `${name}.allowedChanges[${index}]`));
  strings(value.forbiddenChanges, `${name}.forbiddenChanges`);
  for (const field of ["acceptanceCriteria", "validationRequirements"]) {
    if (!Array.isArray(value[field]) || value[field].length === 0) throw new TypeError(`${name}.${field} must be a non-empty array`);
    value[field].forEach((item, index) => validateRule(item, `${name}.${field}[${index}]`));
    unique(value[field], (item) => item.id, `${name}.${field}`);
  }
  return true;
}

export function validatePlan(value, { nullable = false } = {}) {
  exactRecord(value, ["revision", "digest", "content"], "plan");
  integer(value.revision, "plan.revision", 1);
  if (nullable) {
    if (value.digest !== null || value.content !== null) throw new TypeError("initial plan digest and content must be null");
  } else {
    digest(value.digest, "plan.digest"); object(value.content, "plan.content");
    if (sha256Canonical(value.content) !== value.digest) throw new TypeError("plan.digest does not match canonical content");
  }
  return true;
}
function validateEvidence(value, name = "previousEvidence") {
  exactRecord(value, ["digest", "records"], name); digest(value.digest, `${name}.digest`);
  if (!Array.isArray(value.records)) throw new TypeError(`${name}.records must be an array`);
  value.records.forEach((record, index) => {
    exactRecord(record, ["type", "id", "digest", "content"], `${name}.records[${index}]`);
    string(record.type, `${name}.records[${index}].type`); string(record.id, `${name}.records[${index}].id`); digest(record.digest, `${name}.records[${index}].digest`);
    object(record.content, `${name}.records[${index}].content`);
    if (record.type === "result" && sha256Canonical(record.content) !== record.digest) throw new TypeError(`${name}.records[${index}] result content digest mismatch`);
    if (record.type === "summary" && record.content.digest !== record.digest) throw new TypeError(`${name}.records[${index}] summary content digest mismatch`);
  });
  if (sha256Canonical(value.records) !== value.digest) throw new TypeError(`${name}.digest does not match records`);
}
function validateResponseSchema(value, name = "responseSchema") {
  exactRecord(value, ["id", "version"], name); string(value.id, `${name}.id`); integer(value.version, `${name}.version`, 1);
}
function validateModel(value, name = "model") {
  exactRecord(value, ["name", "reasoning"], name); string(value.name, `${name}.name`); oneOf(value.reasoning, ["LOW", "MEDIUM", "HIGH"], `${name}.reasoning`);
}
function validateLimits(value, name = "limits") {
  const fields = ["maxIterations", "maxExecutionSeconds", "maxCycleExecutionSeconds", "maxAdditionalCostUsd", "network", "providers", "publication", "scheduling"];
  exactRecord(value, fields, name);
  if (value.maxIterations !== PHASE2.maxIterations || value.maxExecutionSeconds !== PHASE2.maxExecutionSeconds || value.maxCycleExecutionSeconds !== PHASE2.maxCycleExecutionSeconds || value.maxAdditionalCostUsd !== 0) throw new TypeError(`${name} does not match fixed Phase 2 limits`);
  for (const field of ["network", "providers", "publication", "scheduling"]) if (value[field] !== false) throw new TypeError(`${name}.${field} must be false`);
}
function validateRolePurpose(role, purpose) {
  const expected = { architect: ["ARCHITECT_PLAN", "ARCHITECT_REVISION", "ARCHITECT_FINAL_DECISION"], builder: ["BUILDER_IMPLEMENTATION"], analyst: ["ANALYST_REVIEW"] };
  if (!expected[role]?.includes(purpose)) throw new TypeError("role and purpose do not match");
}

export function validateRoleTask(value) {
  const fields = ["schemaVersion", "controllerId", "repositoryId", "evidenceMode", "cycleId", "taskId", "iteration", "planRevision", "role", "purpose", "binding", "authorization", "plan", "previousEvidence", "responseSchema", "model", "limits", "createdAt", "templateVersion", "taskDigest"];
  exactRecord(value, fields, "roleTask");
  if (value.schemaVersion !== 2) throw new TypeError("roleTask.schemaVersion must be 2");
  for (const field of ["controllerId", "repositoryId", "cycleId", "taskId", "templateVersion"]) string(value[field], `roleTask.${field}`);
  oneOf(value.evidenceMode, EVIDENCE_MODES, "roleTask.evidenceMode"); integer(value.iteration, "roleTask.iteration", 1); if (value.iteration > 3) throw new TypeError("roleTask.iteration must be <= 3");
  integer(value.planRevision, "roleTask.planRevision", 1); oneOf(value.role, ROLES, "roleTask.role"); oneOf(value.purpose, PURPOSES, "roleTask.purpose"); validateRolePurpose(value.role, value.purpose);
  validateBinding(value.binding); validateAuthorization(value.authorization); validatePlan(value.plan, { nullable: value.purpose === "ARCHITECT_PLAN" });
  if (value.purpose === "ARCHITECT_REVISION" && value.plan.revision !== value.planRevision - 1) throw new TypeError("revision task must carry the preceding plan");
  if (!["ARCHITECT_PLAN", "ARCHITECT_REVISION"].includes(value.purpose) && value.plan.revision !== value.planRevision) throw new TypeError("task plan revision mismatch");
  validateEvidence(value.previousEvidence); validateResponseSchema(value.responseSchema); validateModel(value.model); validateLimits(value.limits); utcTimestamp(value.createdAt, "roleTask.createdAt"); digest(value.taskDigest, "roleTask.taskDigest");
  const unsigned = structuredClone(value); delete unsigned.taskDigest;
  if (sha256Canonical(unsigned) !== value.taskDigest) throw new TypeError("roleTask.taskDigest does not match envelope");
  return true;
}

function validateResultContext(value) {
  const fields = ["controllerId", "repositoryId", "evidenceMode", "cycleId", "taskId", "iteration", "planRevision", "role", "purpose", "binding", "authorization", "planDigest", "precedingEvidenceDigest", "responseSchema"];
  exactRecord(value, fields, "result.context");
  for (const field of ["controllerId", "repositoryId", "cycleId", "taskId"]) string(value[field], `result.context.${field}`);
  oneOf(value.evidenceMode, EVIDENCE_MODES, "result.context.evidenceMode"); integer(value.iteration, "result.context.iteration", 1); if (value.iteration > 3) throw new TypeError("result.context.iteration must be <= 3");
  integer(value.planRevision, "result.context.planRevision", 1); oneOf(value.role, ROLES, "result.context.role"); oneOf(value.purpose, PURPOSES, "result.context.purpose"); validateRolePurpose(value.role, value.purpose);
  validateBinding(value.binding, "result.context.binding"); validateAuthorization(value.authorization, "result.context.authorization"); digest(value.planDigest, "result.context.planDigest", true); digest(value.precedingEvidenceDigest, "result.context.precedingEvidenceDigest"); validateResponseSchema(value.responseSchema, "result.context.responseSchema");
}
function validateValidationEvidence(value, name) {
  exactRecord(value, ["schemaVersion", "evidenceType", "provenance", "repositoryId", "evidenceMode", "cycleId", "taskId", "role", "recipeId", "candidateCommit", "outcome", "checkpointIdentityDigest"], name);
  if (value.schemaVersion !== 2 || value.evidenceType !== "ROLE_VALIDATION_ATTESTATION" || value.provenance !== "HUMAN_ATTESTED") throw new TypeError(`${name} type or provenance is invalid`);
  for (const field of ["repositoryId", "cycleId", "taskId", "recipeId"]) string(value[field], `${name}.${field}`);
  oneOf(value.evidenceMode, EVIDENCE_MODES, `${name}.evidenceMode`); oneOf(value.role, ["builder", "analyst"], `${name}.role`); oid(value.candidateCommit, `${name}.candidateCommit`); oneOf(value.outcome, ["PASS", "FAIL"], `${name}.outcome`); digest(value.checkpointIdentityDigest, `${name}.checkpointIdentityDigest`);
}
function validateValidationEntry(value, name) {
  exactRecord(value, ["recipeId", "outcome", "evidence", "evidenceDigest", "skipReason"], name); string(value.recipeId, `${name}.recipeId`); oneOf(value.outcome, ["PASS", "FAIL", "SKIPPED"], `${name}.outcome`); digest(value.evidenceDigest, `${name}.evidenceDigest`, true); nullableString(value.skipReason, `${name}.skipReason`);
  if (value.outcome === "SKIPPED") {
    if (value.skipReason === null || value.evidence !== null || value.evidenceDigest !== null) throw new TypeError(`${name} SKIPPED evidence is invalid`);
    return;
  }
  validateValidationEvidence(value.evidence, `${name}.evidence`);
  if (value.skipReason !== null || value.evidenceDigest === null || value.evidence.recipeId !== value.recipeId || value.evidence.outcome !== value.outcome || sha256Canonical(value.evidence) !== value.evidenceDigest) throw new TypeError(`${name} attestation is inconsistent`);
}
function validateChange(value, name) {
  exactRecord(value, ["path", "operation", "mode"], name); string(value.path, `${name}.path`); oneOf(value.operation, ["ADD", "MODIFY"], `${name}.operation`); if (value.mode !== "100644") throw new TypeError(`${name}.mode must be 100644`);
}
function validateCompletedPayload(payload, context) {
  const name = "result.payload";
  if (["ARCHITECT_PLAN", "ARCHITECT_REVISION"].includes(context.purpose)) {
    const fields = ["goal", "scope", "allowedChanges", "forbiddenChanges", "acceptanceCriteria", "validationRequirements", "risks", "rationale", "resolvesFindingIds"];
    exactRecord(payload, fields, name); for (const field of ["goal", "scope", "rationale"]) string(payload[field], `${name}.${field}`);
    if (!Array.isArray(payload.allowedChanges)) throw new TypeError(`${name}.allowedChanges must be an array`); payload.allowedChanges.forEach((item, i) => validateAllowedChange(item, `${name}.allowedChanges[${i}]`));
    strings(payload.forbiddenChanges, `${name}.forbiddenChanges`); strings(payload.risks, `${name}.risks`); strings(payload.resolvesFindingIds, `${name}.resolvesFindingIds`);
    for (const field of ["acceptanceCriteria", "validationRequirements"]) { if (!Array.isArray(payload[field])) throw new TypeError(`${name}.${field} must be an array`); payload[field].forEach((item, i) => validateRule(item, `${name}.${field}[${i}]`)); }
    return;
  }
  if (context.purpose === "BUILDER_IMPLEMENTATION") {
    const fields = ["candidateCommit", "parentCommit", "treeId", "changedFiles", "validation", "deviations", "blockers"];
    exactRecord(payload, fields, name); oid(payload.candidateCommit, `${name}.candidateCommit`); oid(payload.parentCommit, `${name}.parentCommit`); oid(payload.treeId, `${name}.treeId`);
    if (!Array.isArray(payload.changedFiles)) throw new TypeError(`${name}.changedFiles must be an array`); payload.changedFiles.forEach((item, i) => validateChange(item, `${name}.changedFiles[${i}]`));
    if (!Array.isArray(payload.validation)) throw new TypeError(`${name}.validation must be an array`); payload.validation.forEach((item, i) => validateValidationEntry(item, `${name}.validation[${i}]`)); strings(payload.deviations, `${name}.deviations`); strings(payload.blockers, `${name}.blockers`); return;
  }
  if (context.purpose === "ANALYST_REVIEW") {
    const fields = ["reviewedCommit", "reviewState", "findings", "requiredChanges", "recommendations", "validation"];
    exactRecord(payload, fields, name); oid(payload.reviewedCommit, `${name}.reviewedCommit`); oneOf(payload.reviewState, ANALYST_STATES, `${name}.reviewState`);
    strings(payload.findings, `${name}.findings`); strings(payload.requiredChanges, `${name}.requiredChanges`); strings(payload.recommendations, `${name}.recommendations`);
    if (!Array.isArray(payload.validation)) throw new TypeError(`${name}.validation must be an array`); payload.validation.forEach((item, i) => validateValidationEntry(item, `${name}.validation[${i}]`)); return;
  }
  const fields = ["reviewedCommit", "analystResultDigest", "decision", "rationale", "recommendationDispositions"];
  exactRecord(payload, fields, name); oid(payload.reviewedCommit, `${name}.reviewedCommit`); digest(payload.analystResultDigest, `${name}.analystResultDigest`); oneOf(payload.decision, ARCHITECT_DECISIONS, `${name}.decision`); string(payload.rationale, `${name}.rationale`);
  if (!Array.isArray(payload.recommendationDispositions)) throw new TypeError(`${name}.recommendationDispositions must be an array`);
  payload.recommendationDispositions.forEach((item, i) => { exactRecord(item, ["recommendation", "disposition"], `${name}.recommendationDispositions[${i}]`); string(item.recommendation, `${name}.recommendationDispositions[${i}].recommendation`); string(item.disposition, `${name}.recommendationDispositions[${i}].disposition`); });
}
export function validateRoleResultV2(value, task = null) {
  exactRecord(value, ["schemaVersion", "taskDigest", "context", "outcome", "payload"], "roleResultV2"); if (value.schemaVersion !== 2) throw new TypeError("roleResultV2.schemaVersion must be 2"); digest(value.taskDigest, "roleResultV2.taskDigest"); validateResultContext(value.context); oneOf(value.outcome, ["COMPLETED", "BLOCKED"], "roleResultV2.outcome");
  if (value.outcome === "BLOCKED") { exactRecord(value.payload, ["code", "explanation", "evidence"], "result.payload"); string(value.payload.code, "result.payload.code"); string(value.payload.explanation, "result.payload.explanation"); strings(value.payload.evidence, "result.payload.evidence"); }
  else validateCompletedPayload(value.payload, value.context);
  if (task) {
    validateRoleTask(task); if (value.taskDigest !== task.taskDigest) throw new TypeError("result task digest mismatch");
    const expected = resultContextForTask(task); if (sha256Canonical(value.context) !== sha256Canonical(expected)) throw new TypeError("result context does not exactly echo task context");
    if (value.outcome === "COMPLETED" && value.context.purpose === "BUILDER_IMPLEMENTATION" && value.payload.candidateCommit !== task.binding.candidateCommit && task.binding.candidateCommit !== null) throw new TypeError("builder candidate mismatch");
    if (value.outcome === "COMPLETED" && ["ANALYST_REVIEW", "ARCHITECT_FINAL_DECISION"].includes(value.context.purpose) && value.payload.reviewedCommit !== task.binding.reviewedCommit) throw new TypeError("reviewed commit mismatch");
    if (value.outcome === "COMPLETED" && Array.isArray(value.payload.validation)) {
      const required = task.authorization.validationRequirements.map((item) => item.id); const supplied = value.payload.validation.map((item) => item.recipeId);
      if (new Set(supplied).size !== supplied.length) throw new TypeError("result contains duplicate validation recipes");
      if (supplied.length !== required.length || required.some((item) => !supplied.includes(item)) || supplied.some((item) => !required.includes(item))) throw new TypeError("result validation set does not exactly match required recipes");
    }
  }
  return true;
}
export function resultContextForTask(task) {
  validateRoleTask(task);
  return {
    controllerId: task.controllerId, repositoryId: task.repositoryId, evidenceMode: task.evidenceMode, cycleId: task.cycleId, taskId: task.taskId,
    iteration: task.iteration, planRevision: task.planRevision, role: task.role, purpose: task.purpose, binding: structuredClone(task.binding), authorization: structuredClone(task.authorization),
    planDigest: task.plan.digest, precedingEvidenceDigest: task.previousEvidence.digest, responseSchema: structuredClone(task.responseSchema),
  };
}

export function validateReceipt(value) {
  const fields = ["schemaVersion", "receiptId", "taskId", "taskDigest", "resultDigest", "acceptedAt", "stateVersion", "status"];
  exactRecord(value, fields, "receipt"); if (value.schemaVersion !== 2) throw new TypeError("receipt.schemaVersion must be 2");
  string(value.receiptId, "receipt.receiptId"); string(value.taskId, "receipt.taskId"); digest(value.taskDigest, "receipt.taskDigest"); digest(value.resultDigest, "receipt.resultDigest"); utcTimestamp(value.acceptedAt, "receipt.acceptedAt"); integer(value.stateVersion, "receipt.stateVersion", 1); oneOf(value.status, ["ACCEPTED", "IDEMPOTENT_REPLAY"], "receipt.status"); return true;
}
export function validateIntegrationIntent(value) {
  const fields = ["schemaVersion", "intentId", "repositoryId", "cycleId", "targetRoot", "targetBranch", "oldTip", "newTip", "candidateTree", "scopeDigest", "approvalId", "reviewResultDigest", "architectResultDigest", "status", "createdAt"];
  exactRecord(value, fields, "integrationIntent"); if (value.schemaVersion !== 2) throw new TypeError("integrationIntent.schemaVersion must be 2");
  for (const field of ["intentId", "repositoryId", "cycleId", "targetRoot", "targetBranch", "approvalId"]) string(value[field], `integrationIntent.${field}`);
  if (value.targetBranch !== PHASE2.pilotBranch) throw new TypeError(`integrationIntent.targetBranch must be ${PHASE2.pilotBranch}`);
  for (const field of ["oldTip", "newTip", "candidateTree"]) oid(value[field], `integrationIntent.${field}`);
  for (const field of ["scopeDigest", "reviewResultDigest", "architectResultDigest"]) digest(value[field], `integrationIntent.${field}`);
  oneOf(value.status, ["PREPARED", "APPLIED", "RECONCILIATION_REQUIRED"], "integrationIntent.status"); utcTimestamp(value.createdAt, "integrationIntent.createdAt"); return true;
}

const STATE_V2_FIELDS = ["schemaVersion", "controllerId", "repositoryId", "evidenceMode", "stateVersion", "owner", "queue", "activeCycleId", "humanHold", "approval", "capabilities", "cycles", "plans", "tasks", "pendingTaskId", "results", "receipts", "iterations", "reviews", "summaries", "outbox", "workspaces", "timings", "checkpointIntents", "checkpointReceipts", "integrationIntents", "integrationOutcomes", "migration"];
export function validateMachineStateV2(value) {
  exactRecord(value, STATE_V2_FIELDS, "machineStateV2"); if (value.schemaVersion !== 2) throw new TypeError("machineStateV2.schemaVersion must be 2");
  string(value.controllerId, "machineStateV2.controllerId"); string(value.repositoryId, "machineStateV2.repositoryId"); oneOf(value.evidenceMode, EVIDENCE_MODES, "machineStateV2.evidenceMode"); integer(value.stateVersion, "machineStateV2.stateVersion");
  exactRecord(value.owner, ["id", "generation"], "machineStateV2.owner"); string(value.owner.id, "machineStateV2.owner.id"); integer(value.owner.generation, "machineStateV2.owner.generation", 1);
  if (value.activeCycleId !== null) string(value.activeCycleId, "machineStateV2.activeCycleId"); bool(value.humanHold, "machineStateV2.humanHold"); validateAuthorization(value.approval, "machineStateV2.approval");
  exactRecord(value.capabilities, ["realPilotActivation", "liveProviders", "network", "publication", "scheduling"], "machineStateV2.capabilities"); for (const field of Object.keys(value.capabilities)) if (value.capabilities[field] !== false) throw new TypeError(`machineStateV2.capabilities.${field} must be false`);
  for (const field of ["queue", "cycles", "plans", "tasks", "results", "receipts", "iterations", "reviews", "summaries", "outbox", "workspaces", "timings", "checkpointIntents", "checkpointReceipts", "integrationIntents", "integrationOutcomes"]) if (!Array.isArray(value[field])) throw new TypeError(`machineStateV2.${field} must be an array`);
  if (value.migration === null) {
    value.cycles.forEach((cycle, index) => { const n = `cycles[${index}]`; exactRecord(cycle, ["id", "requestId", "status", "stage", "targetRoot", "targetBranch", "baselineCommit", "expectedTargetTip", "iterationBaseCommit", "iteration", "planRevision", "candidateCommit", "analystResultDigest", "architectDecision", "integrationStatus", "createdAt", "architectResultDigest"].filter((field) => field !== "architectResultDigest" || field in cycle), n); for (const field of ["id", "requestId", "status", "stage", "targetRoot", "targetBranch", "integrationStatus"]) string(cycle[field], `${n}.${field}`); if (cycle.targetBranch !== PHASE2.pilotBranch) throw new TypeError(`${n}.targetBranch must be ${PHASE2.pilotBranch}`); for (const field of ["baselineCommit", "expectedTargetTip", "iterationBaseCommit"]) oid(cycle[field], `${n}.${field}`); oid(cycle.candidateCommit, `${n}.candidateCommit`, true); digest(cycle.analystResultDigest, `${n}.analystResultDigest`, true); nullableString(cycle.architectDecision, `${n}.architectDecision`); integer(cycle.iteration, `${n}.iteration`, 1); if (cycle.iteration > 3) throw new TypeError(`${n}.iteration must be <= 3`); integer(cycle.planRevision, `${n}.planRevision`, 1); utcTimestamp(cycle.createdAt, `${n}.createdAt`); if ("architectResultDigest" in cycle) digest(cycle.architectResultDigest, `${n}.architectResultDigest`); });
  } else value.cycles.forEach(validateCycle);
  value.plans.forEach((plan, index) => { const n = `plans[${index}]`; exactRecord(plan, ["cycleId", "revision", "content", "digest", "architectResultDigest", "createdAt"], n); string(plan.cycleId, `${n}.cycleId`); validatePlan({ revision: plan.revision, digest: plan.digest, content: plan.content }); digest(plan.architectResultDigest, `${n}.architectResultDigest`); utcTimestamp(plan.createdAt, `${n}.createdAt`); });
  value.tasks.forEach(validateRoleTask); value.receipts.forEach(validateReceipt); value.integrationIntents.forEach(validateIntegrationIntent);
  value.results.forEach((record, index) => { const n = `results[${index}]`; exactRecord(record, ["taskId", "taskDigest", "cycleId", "role", "purpose", "resultDigest", "result", "acceptedAt"], n); const task = value.tasks.find((item) => item.taskId === record.taskId); if (!task) throw new TypeError(`${n} references a missing task`); digest(record.resultDigest, `${n}.resultDigest`); if (sha256Canonical(record.result) !== record.resultDigest) throw new TypeError(`${n}.resultDigest mismatch`); validateRoleResultV2(record.result, task); validateRequiredValidationEvidence(value, task, record.result); utcTimestamp(record.acceptedAt, `${n}.acceptedAt`); });
  value.iterations.forEach((item, index) => { const n = `iterations[${index}]`; exactRecord(item, ["id", "cycleId", "index", "planRevision", "candidateCommit", "checkpointReceiptId", "reviewResultDigest"], n); string(item.id, `${n}.id`); string(item.cycleId, `${n}.cycleId`); integer(item.index, `${n}.index`, 1); if (item.index > 3) throw new TypeError(`${n}.index must be <= 3`); integer(item.planRevision, `${n}.planRevision`, 1); oid(item.candidateCommit, `${n}.candidateCommit`); string(item.checkpointReceiptId, `${n}.checkpointReceiptId`); digest(item.reviewResultDigest, `${n}.reviewResultDigest`, true); });
  value.reviews.forEach((item, index) => { const n = `reviews[${index}]`; exactRecord(item, ["id", "cycleId", "iteration", "planRevision", "reviewedCommit", "reviewState", "resultDigest", "createdAt"], n); string(item.id, `${n}.id`); string(item.cycleId, `${n}.cycleId`); integer(item.iteration, `${n}.iteration`, 1); integer(item.planRevision, `${n}.planRevision`, 1); oid(item.reviewedCommit, `${n}.reviewedCommit`); oneOf(item.reviewState, ANALYST_STATES, `${n}.reviewState`); digest(item.resultDigest, `${n}.resultDigest`); utcTimestamp(item.createdAt, `${n}.createdAt`); });
  value.summaries.forEach((item, index) => { const n = `summaries[${index}]`; if (item.type === "ITERATION") { exactRecord(item, ["id", "cycleId", "type", "iteration", "planRevision", "candidateCommit", "reviewState", "resultDigest", "evidenceMode", "createdAt", "digest"], n); integer(item.iteration, `${n}.iteration`, 1); integer(item.planRevision, `${n}.planRevision`, 1); oid(item.candidateCommit, `${n}.candidateCommit`); oneOf(item.reviewState, ANALYST_STATES, `${n}.reviewState`); digest(item.resultDigest, `${n}.resultDigest`); } else if (item.type === "FINAL") { exactRecord(item, ["id", "cycleId", "type", "evidenceMode", "terminalState", "terminalReason", "evidenceChain", "iterations", "planRevisions", "architectDecision", "architectResultDigest", "integration", "productionImpact", "risks", "createdAt", "digest"], n); oneOf(item.terminalState, ["ACCEPTED", "REJECTED", "ESCALATED", "HALTED"], `${n}.terminalState`); string(item.terminalReason, `${n}.terminalReason`); if (!Array.isArray(item.evidenceChain)) throw new TypeError(`${n}.evidenceChain must be an array`); item.evidenceChain.forEach((record, recordIndex) => { exactRecord(record, ["type", "id", "digest"], `${n}.evidenceChain[${recordIndex}]`); string(record.type, `${n}.evidenceChain[${recordIndex}].type`); string(record.id, `${n}.evidenceChain[${recordIndex}].id`); digest(record.digest, `${n}.evidenceChain[${recordIndex}].digest`); }); if (item.architectDecision !== null) oneOf(item.architectDecision, ARCHITECT_DECISIONS, `${n}.architectDecision`); digest(item.architectResultDigest, `${n}.architectResultDigest`, true); if (!Array.isArray(item.iterations) || !Array.isArray(item.planRevisions)) throw new TypeError(`${n} history must be arrays`); exactRecord(item.integration, ["status", "oldTip", "newTip", "scopeDigest"], `${n}.integration`); string(item.integration.status, `${n}.integration.status`); oid(item.integration.oldTip, `${n}.integration.oldTip`, true); oid(item.integration.newTip, `${n}.integration.newTip`, true); digest(item.integration.scopeDigest, `${n}.integration.scopeDigest`, true); string(item.productionImpact, `${n}.productionImpact`); strings(item.risks, `${n}.risks`); } else throw new TypeError(`${n}.type is invalid`); string(item.id, `${n}.id`); string(item.cycleId, `${n}.cycleId`); oneOf(item.evidenceMode, EVIDENCE_MODES, `${n}.evidenceMode`); utcTimestamp(item.createdAt, `${n}.createdAt`); const unsigned = structuredClone(item); delete unsigned.digest; if (sha256Canonical(unsigned) !== item.digest) throw new TypeError(`${n}.digest mismatch`); });
  value.outbox.forEach((item, index) => { const n = `outbox[${index}]`; exactRecord(item, ["id", "status", "payload"], n); string(item.id, `${n}.id`); if (item.status !== "SIMULATED_ACCEPTED") throw new TypeError(`${n}.status must be SIMULATED_ACCEPTED`); exactRecord(item.payload, ["summaryId", "summaryDigest", "simulated"], `${n}.payload`); string(item.payload.summaryId, `${n}.payload.summaryId`); digest(item.payload.summaryDigest, `${n}.payload.summaryDigest`); if (item.payload.simulated !== true) throw new TypeError(`${n}.payload.simulated must be true`); });
  value.workspaces.forEach((item, index) => { const n = `workspaces[${index}]`; exactRecord(item, ["workspaceId", "role", "root", "expectedCommit", "registeredAt", "taskId", "repositoryId"], n); string(item.workspaceId, `${n}.workspaceId`); oneOf(item.role, ROLES, `${n}.role`); string(item.root, `${n}.root`); oid(item.expectedCommit, `${n}.expectedCommit`); utcTimestamp(item.registeredAt, `${n}.registeredAt`); string(item.taskId, `${n}.taskId`); string(item.repositoryId, `${n}.repositoryId`); });
  value.timings.forEach((item, index) => { const n = `timings[${index}]`; exactRecord(item, ["taskId", "status", "waitingStartedAt", "startedAt", "finishedAt", "activeMs", "waitingMs"], n); string(item.taskId, `${n}.taskId`); oneOf(item.status, ["EXECUTING", "COMPLETED"], `${n}.status`); utcTimestamp(item.waitingStartedAt, `${n}.waitingStartedAt`); utcTimestamp(item.startedAt, `${n}.startedAt`); if (item.status === "EXECUTING" && item.finishedAt !== null) throw new TypeError(`${n}.finishedAt must be null while executing`); if (item.status === "COMPLETED") utcTimestamp(item.finishedAt, `${n}.finishedAt`); integer(item.activeMs, `${n}.activeMs`); integer(item.waitingMs, `${n}.waitingMs`); });
  value.checkpointIntents.forEach((item, index) => { const n = `checkpointIntents[${index}]`; const fields = ["intentId", "taskId", "workspaceId", "expectedParent", "path", "status", "createdAt", ...(item.status === "COMPLETED" ? ["candidateCommit", "digest"] : [])]; exactRecord(item, fields, n); for (const field of ["intentId", "taskId", "workspaceId", "path"]) string(item[field], `${n}.${field}`); oid(item.expectedParent, `${n}.expectedParent`); oneOf(item.status, ["PREPARED", "COMPLETED", "RECONCILIATION_REQUIRED"], `${n}.status`); utcTimestamp(item.createdAt, `${n}.createdAt`); if (item.status === "COMPLETED") { oid(item.candidateCommit, `${n}.candidateCommit`); digest(item.digest, `${n}.digest`); } });
  value.checkpointReceipts.forEach((item, index) => { const n = `checkpointReceipts[${index}]`; exactRecord(item, ["receiptId", "taskId", "workspaceId", "parentCommit", "candidateCommit", "treeId", "scopeDigest", "createdAt"], n); for (const field of ["receiptId", "taskId", "workspaceId"]) string(item[field], `${n}.${field}`); for (const field of ["parentCommit", "candidateCommit", "treeId"]) oid(item[field], `${n}.${field}`); digest(item.scopeDigest, `${n}.scopeDigest`); utcTimestamp(item.createdAt, `${n}.createdAt`); });
  value.integrationOutcomes.forEach((item, index) => { const n = `integrationOutcomes[${index}]`; if (item.status === "INTEGRATED") { exactRecord(item, ["intentId", "cycleId", "status", "oldTip", "newTip", "verifiedAt"], n); oid(item.oldTip, `${n}.oldTip`); oid(item.newTip, `${n}.newTip`); utcTimestamp(item.verifiedAt, `${n}.verifiedAt`); } else { exactRecord(item, ["intentId", "cycleId", "status", "observedTip", "observedAt"], n); if (item.status !== "INTEGRATION_RECONCILIATION_REQUIRED") throw new TypeError(`${n}.status is invalid`); oid(item.observedTip, `${n}.observedTip`); utcTimestamp(item.observedAt, `${n}.observedAt`); } string(item.intentId, `${n}.intentId`); string(item.cycleId, `${n}.cycleId`); });
  unique(value.tasks, (item) => item.taskId, "machineStateV2.tasks"); unique(value.receipts, (item) => item.taskId, "machineStateV2.receipts");
  unique(value.results, (item) => item.taskId, "machineStateV2.results"); unique(value.summaries, (item) => item.id, "machineStateV2.summaries"); unique(value.outbox, (item) => item.id, "machineStateV2.outbox"); unique(value.workspaces, (item) => item.workspaceId, "machineStateV2.workspaces");
  unique(value.timings, (item) => item.taskId, "machineStateV2.timings");
  for (const receipt of value.receipts) { const task = value.tasks.find((item) => item.taskId === receipt.taskId); const result = value.results.find((item) => item.taskId === receipt.taskId); if (!task || !result || receipt.taskDigest !== task.taskDigest || receipt.resultDigest !== result.resultDigest) throw new TypeError("receipt/task/result relationship is invalid"); }
  for (const event of value.outbox) if (!value.summaries.some((summary) => summary.id === event.payload.summaryId && summary.digest === event.payload.summaryDigest)) throw new TypeError("outbox references missing summary evidence");
  for (const workspace of value.workspaces) if (!value.tasks.some((task) => task.taskId === workspace.taskId && task.role === workspace.role) || workspace.repositoryId !== value.repositoryId) throw new TypeError("workspace registration relationship is invalid");
  const active = value.cycles.filter((cycle) => !["ACCEPTED", "REJECTED", "ESCALATED", "HALTED"].includes(cycle.status)); if (value.activeCycleId === null ? active.length !== 0 : active.length !== 1 || active[0].id !== value.activeCycleId) throw new TypeError("active cycle relationship is invalid");
  if (value.pendingTaskId !== null) { string(value.pendingTaskId, "machineStateV2.pendingTaskId"); if (!value.tasks.some((task) => task.taskId === value.pendingTaskId)) throw new TypeError("pending task does not exist"); if (value.receipts.some((receipt) => receipt.taskId === value.pendingTaskId)) throw new TypeError("pending task is already accepted"); }
  if (value.migration !== null) { exactRecord(value.migration, ["sourceSchemaVersion", "sourceDigest", "sourceEvidencePath", "migratedAt"], "machineStateV2.migration"); integer(value.migration.sourceSchemaVersion, "migration.sourceSchemaVersion", 1); digest(value.migration.sourceDigest, "migration.sourceDigest"); string(value.migration.sourceEvidencePath, "migration.sourceEvidencePath"); utcTimestamp(value.migration.migratedAt, "migration.migratedAt"); }
  return true;
}
export function validateStateByVersion(value) {
  object(value, "state");
  if (value.schemaVersion === 1) return validateMachineState(value);
  if (value.schemaVersion === 2) return validateMachineStateV2(value);
  throw new TypeError("UNKNOWN_STATE_SCHEMA_VERSION");
}
