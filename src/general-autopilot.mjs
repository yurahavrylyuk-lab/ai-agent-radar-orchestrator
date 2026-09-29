import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { git, changedFiles, resolveCommit } from "./git-evidence.mjs";
import { offlineExecutorSandboxProfile } from "./operator-boundary.mjs";

export const GENERAL_TARGET_ROOT = "/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent";
const VALIDATION = Object.freeze(["npm run build", "npm test", "npm run worker:typecheck"]);
const MAX_ITERATIONS = 3;
const MAX_ROLE_CALLS = 10;
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
function exact(value, fields, code) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) fail(code); }
function parse(role, value) {
  if (role === "architect") { exact(value, ["summary", "allowedPaths", "plan", "acceptance", "constraints"], "GENERAL_ARCHITECT_SCHEMA"); if (typeof value.summary !== "string" || typeof value.plan !== "string" || !Array.isArray(value.allowedPaths) || !value.allowedPaths.every((item) => typeof item === "string" && item) || !Array.isArray(value.acceptance) || !Array.isArray(value.constraints)) fail("GENERAL_ARCHITECT_SCHEMA"); }
  else if (role === "builder") { exact(value, ["summary", "actions", "files"], "GENERAL_BUILDER_SCHEMA"); if (typeof value.summary !== "string" || !Array.isArray(value.actions) || value.actions.some((item) => typeof item !== "string") || !Array.isArray(value.files) || value.files.length === 0 || value.files.length > 32) fail("GENERAL_BUILDER_SCHEMA"); for (const file of value.files) if (!file || typeof file.path !== "string" || typeof file.content !== "string" || !file.path || path.isAbsolute(file.path) || file.path.startsWith(".git/") || file.path.split("/").some((part) => !part || part === "." || part === "..") || Buffer.byteLength(file.content) > 262144) fail("GENERAL_BUILDER_FILE_INVALID"); }
  else if (role === "analyst") { exact(value, ["decision", "findings"], "GENERAL_ANALYST_SCHEMA"); if (!["PASS", "REVISE"].includes(value.decision) || !Array.isArray(value.findings) || value.findings.some((item) => typeof item !== "string")) fail("GENERAL_ANALYST_SCHEMA"); }
  else { exact(value, ["decision", "rationale"], "GENERAL_FINAL_SCHEMA"); if (!["ACCEPT", "REJECT"].includes(value.decision) || typeof value.rationale !== "string") fail("GENERAL_FINAL_SCHEMA"); }
  return value;
}
function shell(command, root, profile) {
  const testMode = process.env.GENERAL_AUTOPILOT_TEST === "1";
  const result = testMode ? spawnSync("/bin/sh", ["-lc", command], { cwd: root, encoding: "utf8", env: { PATH: "/usr/bin:/bin:/usr/local/bin", HOME: root, npm_config_update_notifier: "false" } }) : spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/bin/sh", "-lc", command], { cwd: root, encoding: "utf8", env: { PATH: "/usr/bin:/bin:/usr/local/bin", HOME: root, npm_config_update_notifier: "false" } });
  return { command, status: result.status, output: (result.stdout + result.stderr).slice(0, 16000) };
}
function cloneWorkspace(runtimeRoot, sourceRoot) {
  const requested = path.resolve(runtimeRoot); const parent = fs.realpathSync(path.dirname(requested)); const candidate = path.join(parent, path.basename(requested)); const temporaryRoots = new Set([fs.realpathSync(os.tmpdir()), fs.realpathSync("/private/tmp")]);
  if (!temporaryRoots.has(parent) || path.dirname(requested) !== path.resolve(path.dirname(requested))) fail("GENERAL_RUNTIME_TEMPORARY_ROOT_REQUIRED");
  if (fs.existsSync(candidate)) fail("GENERAL_RUNTIME_NOT_FRESH");
  fs.mkdirSync(candidate, { recursive: false, mode: 0o700 }); const runtime = fs.realpathSync(candidate); const workspace = path.join(runtime, "workspace");
  const baseline = git(sourceRoot, ["rev-parse", "--verify", "self-improvement^{commit}"]).stdout.trim();
  git(runtime, ["clone", "--no-local", "--no-hardlinks", "--branch", "self-improvement", fs.realpathSync(sourceRoot), workspace], { write: true });
  git(workspace, ["remote", "remove", "origin"], { write: true });
  const branch = "autopilot/" + crypto.randomUUID().slice(0, 12); git(workspace, ["switch", "-c", branch, baseline], { write: true });
  return { workspace: fs.realpathSync(workspace), baseline, branch };
}
async function role(transport, name, input, records) { if (records.length >= MAX_ROLE_CALLS) fail("GENERAL_ROLE_CALL_LIMIT"); const value = parse(name, await transport.complete({ role: name, input })); records.push({ role: name, value }); return value; }
export class OpenAIResponsesTransport {
  constructor({ apiKey = process.env.OPENAI_API_KEY, model = process.env.GENERAL_AUTOPILOT_MODEL || "gpt-6-astra" } = {}) { if (!apiKey) fail("GENERAL_OPENAI_API_KEY_REQUIRED"); this.apiKey = apiKey; this.model = model; }
  async complete({ role: name, input }) {
    const schemas = {
      architect: { type: "object", additionalProperties: false, required: ["summary", "allowedPaths", "plan", "acceptance", "constraints"], properties: { summary: { type: "string" }, allowedPaths: { type: "array", items: { type: "string" } }, plan: { type: "string" }, acceptance: { type: "array", items: { type: "string" } }, constraints: { type: "array", items: { type: "string" } } } },
      builder: { type: "object", additionalProperties: false, required: ["summary", "actions", "files"], properties: { summary: { type: "string" }, actions: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } } } },
      analyst: { type: "object", additionalProperties: false, required: ["decision", "findings"], properties: { decision: { type: "string", enum: ["PASS", "REVISE"] }, findings: { type: "array", items: { type: "string" } } } },
      final: { type: "object", additionalProperties: false, required: ["decision", "rationale"], properties: { decision: { type: "string", enum: ["ACCEPT", "REJECT"] }, rationale: { type: "string" } } },
    };
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: "Bearer " + this.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, input: "Return only JSON. Role: " + name + ". Context: " + JSON.stringify(input), max_output_tokens: 4000, text: { format: { type: "json_schema", name: "general_" + name, strict: true, schema: schemas[name] } } }) });
    if (!response.ok) fail("GENERAL_OPENAI_REQUEST_FAILED:" + response.status); const body = await response.json(); try { return JSON.parse(body.output_text); } catch { fail("GENERAL_OPENAI_RESPONSE_MALFORMED"); }
  }
}
export async function runGeneralAutopilot({ instruction, runtimeRoot, transport = new OpenAIResponsesTransport(), sourceRoot = GENERAL_TARGET_ROOT }) {
  if (typeof instruction !== "string" || !instruction.trim()) fail("GENERAL_INSTRUCTION_REQUIRED");
  if (sourceRoot !== GENERAL_TARGET_ROOT && process.env.GENERAL_AUTOPILOT_TEST !== "1") fail("GENERAL_TARGET_FIXED");
  const records = []; const trace = []; const setup = cloneWorkspace(runtimeRoot, sourceRoot); const workspace = setup.workspace;
  const architect = await role(transport, "architect", { instruction, structure: fs.readdirSync(workspace).filter((item) => !item.startsWith(".")).slice(0, 80), constraints: ["No deployment, push, merge, secrets, credentials, provider calls, or orchestrator changes."] }, records); trace.push("[ARCHITECT] plan created");
  const profile = offlineExecutorSandboxProfile({ workspaceRoot: workspace }).profile; const validations = []; let analyst = null; let candidate = null; let changes = [];
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const builder = await role(transport, "builder", { instruction, plan: architect, findings: analyst ? analyst.findings : [], iteration }, records);
    if (builder.files.some((file) => !architect.allowedPaths.includes(file.path))) fail("GENERAL_BUILDER_SCOPE_VIOLATION");
    const executorArgs = ["/usr/local/bin/node", path.join(process.cwd(), "src/general-builder-executor.mjs")];
    const written = process.env.GENERAL_AUTOPILOT_TEST === "1" ? spawnSync(executorArgs[0], executorArgs.slice(1), { cwd: workspace, input: JSON.stringify({ files: builder.files }), encoding: "utf8", env: { GENERAL_WORKSPACE_ROOT: workspace, PATH: "/usr/bin:/bin:/usr/local/bin", HOME: workspace } }) : spawnSync("/usr/bin/sandbox-exec", ["-p", profile, ...executorArgs], { cwd: workspace, input: JSON.stringify({ files: builder.files }), encoding: "utf8", env: { GENERAL_WORKSPACE_ROOT: workspace, PATH: "/usr/bin:/bin:/usr/local/bin", HOME: workspace } });
    if (written.status !== 0) fail("GENERAL_BUILDER_EXECUTOR_FAILED:" + written.stderr.trim()); trace.push("[BUILDER] implementation complete");
    git(workspace, ["add", "--", ...builder.files.map((file) => file.path)], { write: true }); git(workspace, ["-c", "user.name=General Autopilot Builder", "-c", "user.email=autopilot@invalid", "commit", "--no-gpg-sign", "-m", "General autopilot iteration " + iteration], { write: true });
    candidate = resolveCommit(workspace); changes = changedFiles(workspace, setup.baseline, candidate); if (changes.some((change) => !architect.allowedPaths.includes(change.path))) fail("GENERAL_CANDIDATE_SCOPE_VIOLATION");
    const evidence = VALIDATION.map((command) => shell(command, workspace, profile)); validations.push(...evidence); if (evidence.some((item) => item.status !== 0)) fail("GENERAL_VALIDATION_FAILED"); trace.push("[VALIDATION] tests passed");
    analyst = await role(transport, "analyst", { instruction, plan: architect, candidate: { commit: candidate, changes }, validation: evidence }, records); trace.push("[ANALYST] " + analyst.decision);
    if (analyst.decision === "PASS") { const final = await role(transport, "final", { instruction, candidate, validation: evidence, analyst }, records); const status = final.decision === "ACCEPT" ? "READY_FOR_INTEGRATION" : "REJECTED"; trace.push("[ARCHITECT FINAL] " + final.decision, "[STATE] " + status); return { status, instruction, iterations: iteration, branch: setup.branch, baselineCommit: setup.baseline, candidateCommit: candidate, changedFiles: changes.map((item) => item.path), validation: validations, analyst: analyst.decision, architect: final.decision, trace, records, deployment: false, integration: false }; }
  }
  trace.push("[STATE] REJECTED"); return { status: "REJECTED", instruction, iterations: MAX_ITERATIONS, branch: setup.branch, baselineCommit: setup.baseline, candidateCommit: candidate, changedFiles: changes.map((item) => item.path), validation: validations, analyst: "REVISE", architect: null, trace, records, deployment: false, integration: false };
}
