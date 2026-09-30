import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { git, changedFiles, commitMetadata, currentBranch, inspectGit, statusPorcelain, verifyGeneralCandidate } from "./git-evidence.mjs";
import { offlineExecutorSandboxProfile } from "./operator-boundary.mjs";
import { finalizeTerminalCycle, GENERAL_AUTOPILOT_REPOSITORY_ID, enqueueRequest, initializeController, registerWorkspace } from "./coordinator.mjs";
import { createLocalCheckpoint } from "./local-checkpoint.mjs";
import { acquireLock, mutateStateV2, readState } from "./local-store.mjs";
import { finishRoleMeasured, startRole } from "./role-timing.mjs";
import { submitRoleResult } from "./result-submission.mjs";
import { resultContextForTask } from "./validate.mjs";
import { sha256Canonical, sha256Bytes } from "./contracts.mjs";

export const GENERAL_TARGET_ROOT = "/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent";
const CONTROLLER_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const GENERAL_SINGLETON_LOCK = "/private/tmp/ai-agent-radar-general-autopilot-v1.lock";
const VALIDATION = Object.freeze(["npm run build", "npm test", "npm run worker:typecheck"]);
const MAX_ITERATIONS = 3;
const MAX_ROLE_CALLS = 10;
const MAX_ROLE_MS = 15 * 60 * 1000;
const MAX_CYCLE_MS = 90 * 60 * 1000;
const fail = (code, details = {}) => { const error = new Error(code); error.code = code; Object.assign(error, details); throw error; };
const FORBIDDEN_PATH = /(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:\.git|\.github|k8s|terraform|infra|secrets?)(?:\/|$)|(?:^|\/)(?:wrangler|cloudflare|docker-compose|compose|vercel|netlify|firebase)(?:\..+)?$|(?:^|\/)(?:Dockerfile|Procfile)$/iu;
const SECRET_CONTENT = /(?:-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:api[_ -]?key|secret|credential|password|token)\s*[:=]|(?:sk-(?:proj-|[A-Za-z0-9_-]))[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16})/iu;
function safePath(value) {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.split("/").some((part) => !part || part === "." || part === "..") && !FORBIDDEN_PATH.test(value);
}
function safeContent(value) { return typeof value === "string" && !SECRET_CONTENT.test(value); }
function safeText(value) { return safeContent(value) && Buffer.byteLength(value) <= 262144; }
const GENERAL_APPROVAL = Object.freeze({
  approvalId: "general-autopilot-v1", scope: "Bounded General Instruction Autopilot v1 candidate workspace only.", allowedChanges: [],
  forbiddenChanges: ["No deployment", "No integration", "No merge", "No push", "No production configuration or secret mutation"],
  acceptanceCriteria: [{ id: "general-instruction", description: "Implement only the model-approved bounded instruction scope." }],
  validationRequirements: [{ id: "build", description: "npm run build" }, { id: "test", description: "npm test" }, { id: "worker-typecheck", description: "npm run worker:typecheck" }],
});
function now() { return new Date().toISOString(); }
function taskResult(task, payload) { return { schemaVersion: 2, taskDigest: task.taskDigest, context: resultContextForTask(task), outcome: "COMPLETED", payload }; }
function planPayload(instruction, architect, workspace) {
  return { goal: architect.summary, scope: instruction, allowedChanges: architect.allowedPaths.map((file) => ({ path: file, operation: fs.existsSync(path.join(workspace, file)) ? "MODIFY" : "ADD" })), forbiddenChanges: GENERAL_APPROVAL.forbiddenChanges, acceptanceCriteria: architect.acceptance.map((description, index) => ({ id: `acceptance-${index + 1}`, description })).length ? architect.acceptance.map((description, index) => ({ id: `acceptance-${index + 1}`, description })) : GENERAL_APPROVAL.acceptanceCriteria, validationRequirements: GENERAL_APPROVAL.validationRequirements, risks: architect.constraints, rationale: architect.plan, resolvesFindingIds: [] };
}
function checkpointFor(state, task) {
  if (task.purpose === "BUILDER_IMPLEMENTATION") return state.checkpointReceipts.find((item) => item.taskId === task.taskId);
  const iteration = state.iterations.find((item) => item.cycleId === task.cycleId && item.index === task.iteration);
  return state.checkpointReceipts.find((item) => item.receiptId === iteration?.checkpointReceiptId);
}
function validationEntries(state, task, commands) {
  const checkpoint = checkpointFor(state, task); if (!checkpoint) fail("GENERAL_VALIDATION_CHECKPOINT_REQUIRED");
  const metadata = commitMetadata(state.workspaces.find((item) => item.workspaceId === checkpoint.workspaceId).root, checkpoint.candidateCommit);
  const change = changedFiles(state.workspaces.find((item) => item.workspaceId === checkpoint.workspaceId).root, task.binding.baselineCommit, checkpoint.candidateCommit)[0];
  const object = inspectGit(state.workspaces.find((item) => item.workspaceId === checkpoint.workspaceId).root, ["ls-tree", checkpoint.candidateCommit, "--", change.path]).stdout.toString("utf8").match(/^[0-9]{6} blob ([0-9a-f]{40})\t/mu)?.[1];
  if (!object) fail("GENERAL_VALIDATION_OBJECT_MISSING");
  const blob = inspectGit(state.workspaces.find((item) => item.workspaceId === checkpoint.workspaceId).root, ["cat-file", "blob", object]).stdout;
  return GENERAL_APPROVAL.validationRequirements.map((recipe, index) => {
    const command = commands[index]; const evidence = { schemaVersion: 4, evidenceType: "CONTROLLER_EXECUTED_VALIDATION", provenance: "CONTROLLER_EXECUTED", repositoryId: GENERAL_AUTOPILOT_REPOSITORY_ID, evidenceMode: "GENERAL_AUTOPILOT", cycleId: task.cycleId, taskId: task.taskId, role: task.role, recipeId: recipe.id, baselineCommit: task.binding.baselineCommit, candidateCommit: checkpoint.candidateCommit, treeId: metadata.tree, blobObjectId: object, blobDigest: sha256Bytes(blob), mode: "100644", recipeVersion: "general-autopilot-validation-r1", executionId: `validation:${task.taskId}:${index + 1}`, outcome: command.status === 0 ? "PASS" : "FAIL", checkpointIdentityDigest: sha256Canonical(checkpoint), detailsDigest: sha256Canonical({ command: command.command, status: command.status, output: command.output }) };
    return { recipeId: recipe.id, outcome: evidence.outcome, evidence, evidenceDigest: sha256Canonical(evidence), skipReason: null };
  });
}
function exact(value, fields, code) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) fail(code); }
function architectSchemaFailure(reason, details = {}) { fail("GENERAL_ARCHITECT_SCHEMA", { schemaDiagnostics: { role: "architect", reason, ...details } }); }
function textSchemaReason(value) { if (typeof value !== "string") return "STRING_REQUIRED"; if (Buffer.byteLength(value) > 262144) return "MAX_BYTES_EXCEEDED"; if (!safeContent(value)) return "UNSAFE_CONTENT"; return null; }
function architectStrings(field, value) {
  if (!Array.isArray(value)) architectSchemaFailure("ARRAY_REQUIRED", { field });
  for (let index = 0; index < value.length; index += 1) { const reason = textSchemaReason(value[index]); if (reason !== null) architectSchemaFailure(reason, { field, index }); }
}
function parse(role, value) {
  if (role === "architect") {
    const fields = ["summary", "allowedPaths", "plan", "acceptance", "constraints"];
    if (!value || typeof value !== "object" || Array.isArray(value)) architectSchemaFailure("OBJECT_REQUIRED");
    const keys = Object.keys(value); const missingFields = fields.filter((field) => !Object.hasOwn(value, field)); const unexpectedFieldCount = keys.filter((field) => !fields.includes(field)).length;
    if (missingFields.length !== 0 || unexpectedFieldCount !== 0 || keys.length !== fields.length) architectSchemaFailure("EXACT_FIELDS_REQUIRED", { missingFields, unexpectedFieldCount });
    for (const field of ["summary", "plan"]) { const reason = textSchemaReason(value[field]); if (reason !== null) architectSchemaFailure(reason, { field }); }
    if (!Array.isArray(value.allowedPaths)) architectSchemaFailure("ARRAY_REQUIRED", { field: "allowedPaths" });
    if (value.allowedPaths.length === 0 || value.allowedPaths.length > 32) architectSchemaFailure("ITEM_COUNT_INVALID", { field: "allowedPaths" });
    if (new Set(value.allowedPaths).size !== value.allowedPaths.length) architectSchemaFailure("DUPLICATE_PATH", { field: "allowedPaths" });
    for (let index = 0; index < value.allowedPaths.length; index += 1) if (!safePath(value.allowedPaths[index])) architectSchemaFailure("SAFE_RELATIVE_PATH_REQUIRED", { field: "allowedPaths", index });
    architectStrings("acceptance", value.acceptance); architectStrings("constraints", value.constraints);
  }
  else if (role === "builder") { exact(value, ["summary", "actions", "files"], "GENERAL_BUILDER_SCHEMA"); if (!safeText(value.summary) || !Array.isArray(value.actions) || value.actions.some((item) => !safeText(item)) || !Array.isArray(value.files) || value.files.length === 0 || value.files.length > 32) fail("GENERAL_BUILDER_SCHEMA"); for (const file of value.files) if (!file || typeof file.path !== "string" || typeof file.content !== "string" || !safePath(file.path) || !safeContent(file.content) || Buffer.byteLength(file.content) > 262144) fail("GENERAL_BUILDER_FILE_INVALID"); }
  else if (role === "analyst") { exact(value, ["decision", "findings"], "GENERAL_ANALYST_SCHEMA"); if (!["PASS", "REVISE"].includes(value.decision) || !Array.isArray(value.findings) || value.findings.some((item) => !safeText(item))) fail("GENERAL_ANALYST_SCHEMA"); }
  else { exact(value, ["decision", "rationale"], "GENERAL_FINAL_SCHEMA"); if (!["ACCEPT", "REJECT"].includes(value.decision) || !safeText(value.rationale)) fail("GENERAL_FINAL_SCHEMA"); }
  return value;
}
function shell(command, root, profile, testMode, timeout, validationHome) {
  const env = { PATH: "/usr/bin:/bin:/usr/local/bin", HOME: validationHome.home, XDG_CONFIG_HOME: path.join(validationHome.home, ".config"), XDG_CACHE_HOME: path.join(validationHome.home, ".cache"), npm_config_update_notifier: "false", npm_config_cache: path.join(validationHome.home, "npm-cache"), npm_config_loglevel: "silent", TMPDIR: validationHome.tmp, TMP: validationHome.tmp, TEMP: validationHome.tmp };
  const result = testMode ? spawnSync("/bin/sh", ["-lc", command], { cwd: root, encoding: "utf8", env, timeout }) : spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/bin/sh", "-lc", command], { cwd: root, encoding: "utf8", env, timeout });
  return { command, status: result.status, timedOut: result.error?.code === "ETIMEDOUT", output: redactValidationOutput(result.stdout + result.stderr).slice(0, 16000) };
}
function redactValidationOutput(output) {
  return output
    .replace(/((?:anthropic_)?api[_ -]?key\s*[:=]\s*)[^\s'"`]+/giu, "$1[REDACTED]")
    .replace(/((?:secret|credential|password|token)\s*[:=]\s*)[^\s'"`]+/giu, "$1[REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
    .replace(/\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16})\b/gu, "[REDACTED]")
    .replace(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|$)/gu, "[REDACTED_PRIVATE_KEY]");
}
function failValidation(evidence) {
  const failedValidations = evidence.map((item, index) => ({ step: index + 1, command: item.command, status: item.status, timedOut: item.timedOut, output: item.output })).filter((item) => item.status !== 0);
  fail("GENERAL_VALIDATION_FAILED", { failedValidations });
}
function within(root, candidate) { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function prepareValidationHome(workspace) {
  const runtime = path.dirname(workspace); const runtimeStat = fs.lstatSync(runtime); if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()) fail("GENERAL_VALIDATION_RUNTIME_UNSAFE");
  const requested = path.join(runtime, "validation-home"); try { fs.lstatSync(requested); fail("GENERAL_VALIDATION_HOME_PRESENT"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  fs.mkdirSync(requested, { mode: 0o700 }); fs.chmodSync(requested, 0o700); const home = fs.realpathSync(requested);
  if (!within(runtime, home) || within(workspace, home) || within(home, workspace)) fail("GENERAL_VALIDATION_HOME_UNSAFE");
  const requestedTmp = path.join(home, "tmp"); fs.mkdirSync(requestedTmp, { mode: 0o700 }); fs.chmodSync(requestedTmp, 0o700); const tmp = fs.realpathSync(requestedTmp);
  if (!within(home, tmp) || tmp === home) fail("GENERAL_VALIDATION_TEMP_UNSAFE");
  return { home, tmp };
}
function removeValidationHome(validationHome, workspace) {
  const runtime = path.dirname(workspace); const stat = fs.lstatSync(validationHome.home); const temp = fs.lstatSync(validationHome.tmp);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !temp.isDirectory() || temp.isSymbolicLink() || !within(runtime, validationHome.home) || !within(validationHome.home, validationHome.tmp) || within(workspace, validationHome.home) || within(validationHome.home, workspace)) fail("GENERAL_VALIDATION_HOME_UNSAFE");
  fs.rmSync(validationHome.home, { recursive: true, force: true });
}
function restoreValidationGeneratedFile(workspace, candidateCommit) {
  const candidate = path.join(workspace, "worker-configuration.d.ts"); const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("GENERAL_VALIDATION_GENERATED_FILE_UNSAFE");
  const expected = inspectGit(workspace, ["show", `${candidateCommit}:worker-configuration.d.ts`]).stdout;
  fs.writeFileSync(candidate, expected, { mode: stat.mode & 0o777 });
  if (!fs.readFileSync(candidate).equals(expected)) fail("GENERAL_VALIDATION_GENERATED_FILE_RESTORE_FAILED");
}
function cleanupValidationWorkspace(workspace, candidateCommit, validationHome) {
  const entries = statusPorcelain(workspace, { includeIgnored: true }).split("\0").filter(Boolean); let generated = false; let dist = false;
  for (const entry of entries) {
    const pathname = entry.slice(3);
    if (entry.startsWith("!! ") && (pathname === "node_modules/" || pathname.startsWith("node_modules/"))) continue;
    if (entry === " M worker-configuration.d.ts") { generated = true; continue; }
    if ((entry.startsWith("!! ") || entry.startsWith("?? ")) && (pathname === "dist/" || pathname.startsWith("dist/"))) { dist = true; continue; }
    fail("GENERAL_VALIDATION_UNEXPECTED_WORKSPACE_MUTATION");
  }
  if (generated) restoreValidationGeneratedFile(workspace, candidateCommit);
  if (dist) { const output = path.join(workspace, "dist"); const stat = fs.lstatSync(output); if (!stat.isDirectory() || stat.isSymbolicLink()) fail("GENERAL_VALIDATION_DIST_UNSAFE"); fs.rmSync(output, { recursive: true, force: true }); }
  removeValidationHome(validationHome, workspace);
}
function verifyDependencyTree(root) {
  const rootStat = fs.lstatSync(root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("GENERAL_DEPENDENCY_TREE_UNSAFE");
  const canonicalRoot = fs.realpathSync(root);
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name); const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) { const resolved = fs.realpathSync(candidate); if (!within(canonicalRoot, resolved)) fail("GENERAL_DEPENDENCY_SYMLINK_ESCAPE"); continue; }
      if (stat.isDirectory()) visit(candidate);
      else if (!stat.isFile()) fail("GENERAL_DEPENDENCY_TREE_UNSAFE");
    }
  };
  visit(canonicalRoot); return canonicalRoot;
}
function dependencyTreeDigest(root) {
  const canonicalRoot = verifyDependencyTree(root); const entries = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name); const relative = path.relative(canonicalRoot, candidate);
      if (entry.isDirectory()) visit(candidate); else entries.push(relative);
    }
  };
  visit(canonicalRoot); const hash = crypto.createHash("sha256");
  for (const relative of entries.sort()) { hash.update(relative); hash.update("\0"); hash.update(fs.readFileSync(path.join(canonicalRoot, relative))); hash.update("\0"); }
  return hash.digest("hex");
}
function lockfileDigest(root) {
  const lockfile = path.join(root, "package-lock.json"); const stat = fs.lstatSync(lockfile);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("GENERAL_DEPENDENCY_LOCKFILE_REQUIRED");
  return sha256Bytes(fs.readFileSync(lockfile));
}
function prepareWorkspaceDependencies(sourceRoot, workspace) {
  const sourceDependencies = path.join(sourceRoot, "node_modules"); const destination = path.join(workspace, "node_modules");
  let destinationStat = null; try { destinationStat = fs.lstatSync(destination); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (destinationStat !== null || fs.lstatSync(path.dirname(destination)).isSymbolicLink()) fail("GENERAL_WORKSPACE_DEPENDENCIES_PRESENT");
  const sourceLock = lockfileDigest(sourceRoot); if (sourceLock !== lockfileDigest(workspace)) fail("GENERAL_DEPENDENCY_LOCKFILE_MISMATCH");
  const canonicalSource = verifyDependencyTree(sourceDependencies);
  fs.cpSync(canonicalSource, destination, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false, preserveTimestamps: false });
  const canonicalDestination = verifyDependencyTree(destination);
  return { source: canonicalSource, destination: canonicalDestination, lockfileDigest: sourceLock, digest: dependencyTreeDigest(canonicalDestination) };
}
function cloneWorkspace(runtimeRoot, sourceRoot) {
  const requested = path.resolve(runtimeRoot); const parent = fs.realpathSync(path.dirname(requested)); const candidate = path.join(parent, path.basename(requested)); const temporaryRoots = new Set([fs.realpathSync(os.tmpdir()), fs.realpathSync("/private/tmp")]);
  if (!temporaryRoots.has(parent) || path.dirname(requested) !== path.resolve(path.dirname(requested))) fail("GENERAL_RUNTIME_TEMPORARY_ROOT_REQUIRED");
  if (fs.existsSync(candidate)) fail("GENERAL_RUNTIME_NOT_FRESH");
  fs.mkdirSync(candidate, { recursive: false, mode: 0o700 }); const runtime = fs.realpathSync(candidate); const workspace = path.join(runtime, "workspace");
  const baseline = git(sourceRoot, ["rev-parse", "--verify", "self-improvement^{commit}"]).stdout.trim();
  git(runtime, ["clone", "--no-local", "--no-hardlinks", "--branch", "self-improvement", fs.realpathSync(sourceRoot), workspace], { write: true });
  git(workspace, ["remote", "remove", "origin"], { write: true });
  const branch = "autopilot/" + crypto.randomUUID().slice(0, 12); git(workspace, ["switch", "-c", branch, baseline], { write: true }); const dependencies = prepareWorkspaceDependencies(sourceRoot, workspace);
  return { workspace: fs.realpathSync(workspace), baseline, branch, dependencies };
}
async function role(transport, name, input, records, timeoutMs) {
  if (records.length >= MAX_ROLE_CALLS) fail("GENERAL_ROLE_CALL_LIMIT");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail("GENERAL_ROLE_EXECUTION_LIMIT_EXCEEDED");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { const value = parse(name, await transport.complete({ role: name, input, signal: controller.signal })); records.push({ role: name, value }); return value; } catch (error) { if (controller.signal.aborted) fail("GENERAL_ROLE_EXECUTION_LIMIT_EXCEEDED"); throw error; } finally { clearTimeout(timeout); }
}
export class ClaudeMessagesTransport {
  constructor({ apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6" } = {}) { if (!apiKey) fail("GENERAL_ANTHROPIC_API_KEY_REQUIRED"); this.apiKey = apiKey; this.model = model; }
  async complete({ role: name, input, signal }) {
    const schemas = {
      architect: { type: "object", additionalProperties: false, required: ["summary", "allowedPaths", "plan", "acceptance", "constraints"], properties: { summary: { type: "string", minLength: 1, maxLength: 262144 }, allowedPaths: { type: "array", minItems: 1, maxItems: 32, uniqueItems: true, items: { type: "string", minLength: 1 } }, plan: { type: "string", minLength: 1, maxLength: 262144, description: "One implementation-oriented Markdown string. Do not return an array or object." }, acceptance: { type: "array", items: { type: "string" } }, constraints: { type: "array", items: { type: "string" } } } },
      builder: { type: "object", additionalProperties: false, required: ["summary", "actions", "files"], properties: { summary: { type: "string" }, actions: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } } } },
      analyst: { type: "object", additionalProperties: false, required: ["decision", "findings"], properties: { decision: { type: "string", enum: ["PASS", "REVISE"] }, findings: { type: "array", items: { type: "string" } } } },
      final: { type: "object", additionalProperties: false, required: ["decision", "rationale"], properties: { decision: { type: "string", enum: ["ACCEPT", "REJECT"] }, rationale: { type: "string" } } },
    };
    const toolName = "general_" + name + "_result";
    const architectInstructions = name === "architect" ? " Return exactly these fields and no others: summary (string), allowedPaths (non-empty array of safe relative paths), plan (one Markdown string, never an array or object), acceptance (array of strings), constraints (array of strings). Put prioritized steps and headings inside the single plan string; do not use a wrapper, code fence, or prose outside the tool input." : "";
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal, headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, max_tokens: 4000, messages: [{ role: "user", content: "Return the role result only through the required structured-result tool. Role: " + name + "." + architectInstructions + " Context: " + JSON.stringify(input) }], tools: [{ name: toolName, description: "Return the validated General Instruction Autopilot role result." + (name === "architect" ? " The plan field is one implementation-oriented Markdown string." : ""), input_schema: schemas[name] }], tool_choice: { type: "tool", name: toolName } }) });
    if (!response.ok) fail("GENERAL_ANTHROPIC_REQUEST_FAILED:" + response.status); const body = await response.json(); const calls = Array.isArray(body.content) ? body.content.filter((item) => item?.type === "tool_use" && item.name === toolName) : [];
    if (calls.length !== 1 || !calls[0].input || typeof calls[0].input !== "object" || Array.isArray(calls[0].input)) fail("GENERAL_ANTHROPIC_RESPONSE_MALFORMED");
    return calls[0].input;
  }
}
function terminateCycle({ statePath, ownerId, taskId = null, code, stage = "FAILED" }) {
  const finishedAt = now();
  mutateStateV2({ statePath, ownerId, ownerGeneration: 1, mutator(state) {
    const task = state.tasks.find((item) => item.taskId === taskId) ?? state.tasks.find((item) => item.taskId === state.pendingTaskId); const timing = state.timings.find((item) => item.taskId === task?.taskId);
    if (timing?.status === "EXECUTING") { timing.status = "INTERRUPTED"; timing.finishedAt = finishedAt; timing.activeMs = Math.max(0, Date.parse(finishedAt) - Date.parse(timing.startedAt)); }
    const cycle = state.cycles.find((item) => item.id === task?.cycleId);
    if (cycle && state.activeCycleId === cycle.id) finalizeTerminalCycle(state, cycle, { status: "HALTED", stage, terminalReason: code, now: finishedAt });
    else return { unchanged: true };
    state.stateVersion += 1; return { state };
  }});
}
function haltForLimit({ statePath, ownerId, taskId, code }) {
  terminateCycle({ statePath, ownerId, taskId, code, stage: "LIMIT_EXCEEDED" });
  fail(code);
}
async function runGeneralAutopilotCore({ instruction, runtimeRoot, transport, sourceRoot, testMode, sandboxedValidation = false }) {
  if (!safeText(instruction) || !instruction.trim()) fail("GENERAL_INSTRUCTION_REQUIRED");
  if (!testMode && fs.realpathSync(sourceRoot) !== fs.realpathSync(GENERAL_TARGET_ROOT)) fail("GENERAL_TARGET_FIXED");
  const sourceBefore = { head: git(sourceRoot, ["rev-parse", "--verify", "self-improvement^{commit}"]).stdout.trim(), status: statusPorcelain(sourceRoot) };
  if (sourceBefore.status !== "") fail("GENERAL_TARGET_NOT_CLEAN");
  let statePath = null; const ownerId = "general-autopilot-controller";
  try {
  const records = []; const trace = []; const setup = cloneWorkspace(runtimeRoot, sourceRoot); const workspace = setup.workspace; statePath = path.join(path.dirname(workspace), "general-controller-state.json");
  initializeController(statePath, { controllerId: ownerId, repositoryId: GENERAL_AUTOPILOT_REPOSITORY_ID, evidenceMode: "GENERAL_AUTOPILOT", generalAutopilot: true, ownerId, targetRoot: sourceRoot, approval: GENERAL_APPROVAL });
  enqueueRequest({ statePath, ownerId, ownerGeneration: 1, request: { schemaVersion: 2, requestId: crypto.randomUUID(), repositoryId: GENERAL_AUTOPILOT_REPOSITORY_ID, targetRoot: sourceRoot, targetBranch: "self-improvement", baselineCommit: setup.baseline, createdAt: now() } });
  const cycleDeadline = Date.now() + MAX_CYCLE_MS;
  const deadlines = new Map();
  const remaining = (task) => {
    const deadline = deadlines.get(task.taskId) ?? cycleDeadline; const value = Math.min(deadline, cycleDeadline) - Date.now();
    if (value <= 0) haltForLimit({ statePath, ownerId, taskId: task.taskId, code: deadline <= cycleDeadline ? "GENERAL_ROLE_EXECUTION_LIMIT_EXCEEDED" : "GENERAL_CYCLE_EXECUTION_LIMIT_EXCEEDED" });
    return value;
  };
  const limitCode = (task) => (deadlines.get(task.taskId) ?? cycleDeadline) <= cycleDeadline ? "GENERAL_ROLE_EXECUTION_LIMIT_EXCEEDED" : "GENERAL_CYCLE_EXECUTION_LIMIT_EXCEEDED";
  const begin = (task) => { const available = cycleDeadline - Date.now(); if (available <= 0) haltForLimit({ statePath, ownerId, taskId: task.taskId, code: "GENERAL_CYCLE_EXECUTION_LIMIT_EXCEEDED" }); deadlines.set(task.taskId, Date.now() + Math.min(MAX_ROLE_MS, available)); const started = now(); startRole({ statePath, ownerId, ownerGeneration: 1, taskId: task.taskId, now: started }); return Date.now(); };
  const finish = (task, started) => { remaining(task); finishRoleMeasured({ statePath, ownerId, ownerGeneration: 1, taskId: task.taskId, now: now(), activeMs: Date.now() - started }); };
  const complete = (task, payload) => submitRoleResult({ statePath, ownerId, ownerGeneration: 1, result: taskResult(task, payload), now: now() });
  const runRole = async (task, name, input) => {
    try { return await role(transport, name, input, records, remaining(task)); }
    catch (error) {
      if (error?.code === "GENERAL_ROLE_EXECUTION_LIMIT_EXCEEDED") haltForLimit({ statePath, ownerId, taskId: task.taskId, code: limitCode(task) });
      throw error;
    }
  };
  let state = readState(statePath); let task = state.tasks.find((item) => item.taskId === state.pendingTaskId);
  let started = begin(task); const architect = await runRole(task, "architect", { instruction, structure: fs.readdirSync(workspace).filter((item) => !item.startsWith(".")).slice(0, 80), constraints: GENERAL_APPROVAL.forbiddenChanges }); finish(task, started); complete(task, planPayload(instruction, architect, workspace)); trace.push("[ARCHITECT] plan created");
  const sandbox = offlineExecutorSandboxProfile({ workspaceRoot: workspace }); const profile = sandbox.profile; const executorEnv = testMode
    ? { GENERAL_WORKSPACE_ROOT: workspace, GENERAL_TEST_CONFINEMENT: "1", PATH: "/usr/bin:/bin:/usr/local/bin", HOME: workspace }
    : { GENERAL_WORKSPACE_ROOT: workspace, GENERAL_BOUNDARY_ROOTS: JSON.stringify(Object.fromEntries(Object.entries(sandbox.roots).map(([name, root]) => [name, root.canonicalRoot]))), GENERAL_POLICY_DIGEST: sandbox.digest, PATH: "/usr/bin:/bin:/usr/local/bin", HOME: workspace };
  const validations = []; const executorConfinement = []; let analyst = null; let candidate = null; let changes = [];
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    state = readState(statePath); task = state.tasks.find((item) => item.taskId === state.pendingTaskId); if (!task || task.purpose !== "BUILDER_IMPLEMENTATION") fail("GENERAL_CONTROLLER_BUILDER_HANDOFF_REQUIRED");
    registerWorkspace({ statePath, ownerId, ownerGeneration: 1, taskId: task.taskId, workspace: { workspaceId: task.binding.workspaceId, role: "builder", root: workspace, expectedCommit: task.binding.iterationBaseCommit, registeredAt: now() } });
    started = begin(task); const builder = await runRole(task, "builder", { instruction, plan: architect, findings: analyst ? analyst.findings : [], iteration }); if (builder.files.some((file) => !architect.allowedPaths.includes(file.path))) fail("GENERAL_BUILDER_SCOPE_VIOLATION");
    const executorArgs = ["/usr/local/bin/node", path.join(CONTROLLER_ROOT, "src/general-builder-executor.mjs")]; const written = testMode ? spawnSync(executorArgs[0], executorArgs.slice(1), { cwd: workspace, input: JSON.stringify({ files: builder.files }), encoding: "utf8", env: executorEnv, timeout: remaining(task) }) : spawnSync("/usr/bin/sandbox-exec", ["-p", profile, ...executorArgs], { cwd: workspace, input: JSON.stringify({ files: builder.files }), encoding: "utf8", env: executorEnv, timeout: remaining(task) });
    if (written.error?.code === "ETIMEDOUT") haltForLimit({ statePath, ownerId, taskId: task.taskId, code: limitCode(task) });
    if (written.status !== 0) fail("GENERAL_BUILDER_EXECUTOR_FAILED:" + written.stderr.trim()); trace.push("[BUILDER] implementation complete");
    let executorOutput; try { executorOutput = JSON.parse(written.stdout); } catch { fail("GENERAL_BUILDER_EXECUTOR_OUTPUT_INVALID"); }
    if (!Array.isArray(executorOutput.written) || !executorOutput.written.every((file) => builder.files.some((item) => item.path === file))) fail("GENERAL_BUILDER_EXECUTOR_OUTPUT_INVALID");
    if (!testMode && (executorOutput.confinement?.mechanism !== "MACOS_SANDBOX_CHECK" || executorOutput.confinement.policyDigest !== sandbox.digest || !Array.isArray(executorOutput.confinement.records) || executorOutput.confinement.records.length !== 14)) fail("GENERAL_BUILDER_CONFINEMENT_MISMATCH");
    executorConfinement.push(executorOutput.confinement);
    remaining(task); const checkpoint = createLocalCheckpoint({ statePath, ownerId, ownerGeneration: 1, taskId: task.taskId, now: now() }).receipt; remaining(task); candidate = checkpoint.candidateCommit; changes = changedFiles(workspace, setup.baseline, candidate); if (currentBranch(workspace) !== setup.branch) fail("GENERAL_WORKSPACE_BRANCH_MISMATCH");
    const validationHome = prepareValidationHome(workspace); const validationProfile = offlineExecutorSandboxProfile({ workspaceRoot: workspace, validationHome: validationHome.home }).profile; const dependencyDigest = dependencyTreeDigest(path.join(workspace, "node_modules")); const evidence = VALIDATION.map((command) => shell(command, workspace, validationProfile, testMode && !sandboxedValidation, remaining(task), validationHome)); const timedOut = evidence.some((item) => item.timedOut); cleanupValidationWorkspace(workspace, checkpoint.candidateCommit, validationHome); if (dependencyTreeDigest(path.join(workspace, "node_modules")) !== dependencyDigest) fail("GENERAL_DEPENDENCY_TREE_MUTATED"); remaining(task); verifyGeneralCandidate({ root: workspace, candidateCommit: checkpoint.candidateCommit, expectedParent: checkpoint.parentCommit, baselineCommit: setup.baseline, allowedPaths: task.plan.content.allowedChanges.map((item) => item.path), previousCandidate: iteration > 1 ? checkpoint.parentCommit : null }); remaining(task); validations.push(...evidence); if (timedOut) haltForLimit({ statePath, ownerId, taskId: task.taskId, code: limitCode(task) }); if (evidence.some((item) => item.status !== 0)) failValidation(evidence); trace.push("[VALIDATION] PASS");
    state = readState(statePath); finish(task, started); complete(task, { candidateCommit: checkpoint.candidateCommit, parentCommit: checkpoint.parentCommit, treeId: checkpoint.treeId, changedFiles: task.plan.content.allowedChanges.map((item) => ({ ...item, mode: "100644" })), validation: validationEntries(state, task, evidence), deviations: [], blockers: [] });
    state = readState(statePath); task = state.tasks.find((item) => item.taskId === state.pendingTaskId); registerWorkspace({ statePath, ownerId, ownerGeneration: 1, taskId: task.taskId, workspace: { workspaceId: task.binding.workspaceId, role: "analyst", root: workspace, expectedCommit: candidate, registeredAt: now() } });
    started = begin(task); analyst = await runRole(task, "analyst", { instruction, plan: architect, candidate: { commit: candidate, changes }, validation: evidence }); trace.push("[ANALYST] " + analyst.decision); state = readState(statePath); finish(task, started); complete(task, { reviewedCommit: candidate, reviewState: analyst.decision, findings: analyst.findings, requiredChanges: analyst.findings, recommendations: [], validation: validationEntries(state, task, evidence) });
    if (analyst.decision === "PASS") { state = readState(statePath); task = state.tasks.find((item) => item.taskId === state.pendingTaskId); started = begin(task); const final = await runRole(task, "final", { instruction, candidate, validation: evidence, analyst }); finish(task, started); complete(task, { reviewedCommit: candidate, analystResultDigest: state.analystResultDigest ?? readState(statePath).cycles[0].analystResultDigest, decision: final.decision, rationale: final.rationale, recommendationDispositions: [] }); const status = final.decision === "ACCEPT" ? "READY_FOR_INTEGRATION" : "REJECTED"; const sourceAfter = { head: git(sourceRoot, ["rev-parse", "--verify", "self-improvement^{commit}"]).stdout.trim(), status: statusPorcelain(sourceRoot) }; if (JSON.stringify(sourceAfter) !== JSON.stringify(sourceBefore)) fail("GENERAL_TARGET_MUTATED"); trace.push("[ARCHITECT FINAL] " + final.decision, "[STATE] " + status); return { status, instruction, iterations: iteration, branch: setup.branch, baselineCommit: setup.baseline, candidateCommit: candidate, changedFiles: changes.map((item) => item.path), validation: validations, executorConfinement, dependencyPreparation: setup.dependencies, analyst: analyst.decision, architect: final.decision, trace, records, controllerStatePath: statePath, deployment: false, integration: false }; }
  }
  state = readState(statePath); task = state.tasks.find((item) => item.taskId === state.pendingTaskId); if (!task || task.purpose !== "ARCHITECT_FINAL_DECISION") fail("GENERAL_CONTROLLER_FINAL_HANDOFF_REQUIRED");
  started = begin(task); const final = await runRole(task, "final", { instruction, candidate, validation: validations, analyst }); if (final.decision !== "REJECT") fail("GENERAL_ARCHITECT_ACCEPT_WITHOUT_ANALYST_PASS"); finish(task, started);
  complete(task, { reviewedCommit: candidate, analystResultDigest: readState(statePath).cycles[0].analystResultDigest, decision: final.decision, rationale: final.rationale, recommendationDispositions: [] });
  const sourceAfter = { head: git(sourceRoot, ["rev-parse", "--verify", "self-improvement^{commit}"]).stdout.trim(), status: statusPorcelain(sourceRoot) }; if (JSON.stringify(sourceAfter) !== JSON.stringify(sourceBefore)) fail("GENERAL_TARGET_MUTATED");
  trace.push("[ARCHITECT FINAL] REJECT", "[STATE] REJECTED"); return { status: "REJECTED", instruction, iterations: MAX_ITERATIONS, branch: setup.branch, baselineCommit: setup.baseline, candidateCommit: candidate, changedFiles: changes.map((item) => item.path), validation: validations, executorConfinement, dependencyPreparation: setup.dependencies, analyst: "REVISE", architect: "REJECT", trace, records, controllerStatePath: statePath, deployment: false, integration: false };
  } catch (error) {
    if (statePath !== null) {
      try { terminateCycle({ statePath, ownerId, code: `GENERAL_FAIL_CLOSED:${error.code ?? error.message}` }); }
      catch (terminalError) { if (terminalError.code !== "STATE_LOCKED") throw terminalError; }
    }
    throw error;
  } finally {
    const sourceAfter = { head: git(sourceRoot, ["rev-parse", "--verify", "self-improvement^{commit}"]).stdout.trim(), status: statusPorcelain(sourceRoot) };
    if (JSON.stringify(sourceAfter) !== JSON.stringify(sourceBefore)) fail("GENERAL_TARGET_MUTATED");
  }
}
export async function runGeneralAutopilot({ instruction, runtimeRoot, transport = new ClaudeMessagesTransport() }) {
  const lock = acquireLock(GENERAL_SINGLETON_LOCK, { controllerId: "general-autopilot-v1", pid: process.pid });
  if (!lock.acquired) fail("GENERAL_AUTOPILOT_ACTIVE_CYCLE");
  try { return await runGeneralAutopilotCore({ instruction, runtimeRoot, transport, sourceRoot: GENERAL_TARGET_ROOT, testMode: false }); } finally { lock.release(); }
}
export async function runGeneralAutopilotForTest({ instruction, runtimeRoot, transport, sourceRoot, sandboxedValidation = false }) {
  return runGeneralAutopilotCore({ instruction, runtimeRoot, transport, sourceRoot, testMode: true, sandboxedValidation });
}
