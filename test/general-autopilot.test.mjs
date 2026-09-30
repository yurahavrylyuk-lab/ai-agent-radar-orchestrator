import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ClaudeMessagesTransport, runGeneralAutopilotForTest } from "../src/general-autopilot.mjs";
import { git, statusPorcelain } from "../src/git-evidence.mjs";
import { offlineExecutorSandboxProfile, PRODUCTION_AUTHORITY_ROOT, PRODUCTION_CONTROLLER_ROOT, PROTECTED_REAL_TARGET_ROOT } from "../src/operator-boundary.mjs";

function fixture({ scripts = { build: "tsc", test: "node -e \"\"", "worker:typecheck": "tsc" }, dependencyLink = "relative", ignoredPaths = "node_modules/\n" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-autopilot-"));
  git(root, ["init", "-b", "main"], { write: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ name: "general-autopilot-fixture", lockfileVersion: 3, requires: true, packages: {} }));
  fs.writeFileSync(path.join(root, ".gitignore"), ignoredPaths);
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  fs.writeFileSync(path.join(root, "worker-configuration.d.ts"), "declare const candidate: true;\n");
  git(root, ["add", "."], { write: true }); git(root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", "commit", "--no-gpg-sign", "-m", "baseline"], { write: true });
  git(root, ["branch", "self-improvement"]); const typescriptTsc = path.join(root, "node_modules", "typescript", "bin", "tsc"); fs.mkdirSync(path.dirname(typescriptTsc), { recursive: true }); fs.writeFileSync(typescriptTsc, "#!/bin/sh\nexit 0\n", { mode: 0o755 }); fs.chmodSync(typescriptTsc, 0o755); const tsc = path.join(root, "node_modules", ".bin", "tsc"); fs.mkdirSync(path.dirname(tsc), { recursive: true }); fs.symlinkSync(dependencyLink === "relative" ? "../typescript/bin/tsc" : dependencyLink === "source-absolute" ? typescriptTsc : "/private/tmp", tsc);
  return root;
}
function dependencySnapshot(root) {
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name); const relative = path.relative(root, candidate); const stat = fs.lstatSync(candidate);
      const mode = stat.mode & 0o7777;
      if (stat.isDirectory()) { records.push([relative, "directory", mode]); visit(candidate); }
      else if (stat.isSymbolicLink()) records.push([relative, "symlink", mode, fs.readlinkSync(candidate)]);
      else if (stat.isFile()) records.push([relative, "file", mode, crypto.createHash("sha256").update(fs.readFileSync(candidate)).digest("hex")]);
      else throw new Error("UNSAFE_TEST_DEPENDENCY_ENTRY");
    }
  };
  visit(root); return JSON.stringify(records);
}
function transport({ revise = false, malformed = false, architectResult = null } = {}) {
  let builder = 0; let analyst = 0;
  return { async complete({ role }) {
    if (malformed && role === "architect") return { nope: true };
    if (role === "architect") return architectResult ?? { summary: "Add a harmless document.", allowedPaths: ["docs/general-smoke.md"], plan: "Write one documentation file.", acceptance: ["File exists."], constraints: ["No deployment."] };
    if (role === "builder") { builder += 1; const file = architectResult?.allowedPaths?.[0] ?? "docs/general-smoke.md"; return { summary: "Write the approved document.", actions: ["write " + file], files: [{ path: file, content: "# General smoke\n\nIteration " + builder + "\n" }] }; }
    if (role === "analyst") { analyst += 1; return revise && analyst === 1 ? { decision: "REVISE", findings: ["Clarify the document."] } : { decision: "PASS", findings: [] }; }
    return { decision: "ACCEPT", rationale: "Validated candidate is acceptable." };
  }};
}
function retryTransport(architectResults) {
  const calls = []; const results = [...architectResults];
  return { calls, async complete({ role, input }) {
    calls.push({ role, input: structuredClone(input) });
    if (role === "architect") return results.shift();
    if (role === "builder") return { summary: "Write the approved document.", actions: ["write docs/general-smoke.md"], files: [{ path: "docs/general-smoke.md", content: "# General smoke\n" }] };
    if (role === "analyst") return { decision: "PASS", findings: [] };
    return { decision: "ACCEPT", rationale: "Validated candidate is acceptable." };
  }};
}
const validArchitectResult = Object.freeze({ summary: "Add a harmless document.", allowedPaths: ["docs/general-smoke.md"], plan: "Write one documentation file.", acceptance: ["File exists."], constraints: ["No deployment."] });
function run(options = {}, sourceRoot = fixture()) {
  const baseline = git(sourceRoot, ["rev-parse", "self-improvement"]).stdout.trim(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  return runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: transport(options) }).then((result) => ({ ...result, sourceRoot, baseline }));
}
function nodeScript(source) { return `node -e ${JSON.stringify(source)}`; }
function hygieneScripts({ tracked = null, unexpected = null, mutateDependency = false } = {}) {
  const build = 'const fs=require("node:fs");fs.mkdirSync("dist",{recursive:true});fs.writeFileSync("dist/output.js","generated");process.stdout.write("build-generated\\n")';
  const test = 'const fs=require("node:fs"),path=require("node:path");const state=path.join(process.env.HOME,"Library","Preferences",".wrangler");fs.mkdirSync(state,{recursive:true});fs.writeFileSync(path.join(state,"metrics.json"),"state");process.stdout.write("test-generated\\n")';
  const worker = `const fs=require("node:fs"),path=require("node:path");fs.writeFileSync("worker-configuration.d.ts","validation-generated\\n");${tracked ? `fs.writeFileSync(${JSON.stringify(tracked)},"unexpected\\n");` : ""}${unexpected ? `fs.mkdirSync(path.dirname(${JSON.stringify(unexpected)}),{recursive:true});fs.writeFileSync(${JSON.stringify(unexpected)},"unexpected\\n");` : ""}${mutateDependency ? 'fs.writeFileSync("node_modules/typescript/bin/tsc","mutated\\n");' : ""}process.stdout.write("worker-generated\\n")`;
  return { build: nodeScript(build), test: nodeScript(test), "worker:typecheck": nodeScript(worker) };
}
function validationTempScripts(externalPath) {
  const build = [
    'const fs=require("node:fs"),net=require("node:net"),os=require("node:os"),path=require("node:path");',
    'const tmp=os.tmpdir();if(tmp!==process.env.TMPDIR||tmp!==process.env.TMP||tmp!==process.env.TEMP||tmp!==path.join(process.env.HOME,"tmp"))throw new Error("TEMP_ENV_MISMATCH");',
    'const denied=(action)=>new Promise((resolve)=>{let socket;try{socket=action()}catch(error){resolve(["EPERM","EACCES"].includes(error.code));return}socket.once("error",(error)=>resolve(["EPERM","EACCES"].includes(error.code)));socket.once("listening",()=>socket.close(()=>resolve(false)));});',
    '(async()=>{const probe=fs.mkdtempSync(path.join(tmp,"general-autopilot-probe-"));fs.writeFileSync(path.join(probe,"probe"),"ok");fs.rmSync(probe,{recursive:true,force:true});',
    'const socketPath=path.join(tmp,"tsx-"+process.pid+".pipe"),server=net.createServer();await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(socketPath,()=>server.close((error)=>error?reject(error):resolve()));});const socketRemoved=!fs.existsSync(socketPath);if(!socketRemoved)fs.unlinkSync(socketPath);',
    'fs.writeFileSync("workspace-write-probe","ok");const workspaceWriteAllowed=fs.readFileSync("workspace-write-probe","utf8")==="ok";fs.unlinkSync("workspace-write-probe");const homeProbe=path.join(tmp,"validation-home-write-probe");fs.writeFileSync(homeProbe,"ok");const homeWriteAllowed=fs.readFileSync(homeProbe,"utf8")==="ok";fs.unlinkSync(homeProbe);',
    'let externalDenied=false;try{fs.writeFileSync(', JSON.stringify(externalPath), ',"forbidden")}catch(error){externalDenied=["EPERM","EACCES"].includes(error.code)}',
    'const externalSocketPath=', JSON.stringify(`${externalPath}.socket`), ';const externalSocketDenied=await denied(()=>net.createServer().listen(externalSocketPath));if(fs.existsSync(externalSocketPath))fs.unlinkSync(externalSocketPath);const inboundDenied=await denied(()=>net.createServer().listen({port:0,host:"127.0.0.1"}));const outboundDenied=await denied(()=>net.createConnection({port:9,host:"127.0.0.1"}));if(!socketRemoved||!workspaceWriteAllowed||!homeWriteAllowed||!externalDenied||!externalSocketDenied||!inboundDenied||!outboundDenied)throw new Error("VALIDATION_SOCKET_CONFINEMENT_FAILED");',
    'process.stdout.write("TEMP_REPORT:"+JSON.stringify({tmp,tmpdir:os.tmpdir(),tmpEnv:process.env.TMP,tmpVariable:process.env.TEMP,mode:fs.statSync(tmp).mode&0o7777,socketPath,socketRemoved,workspaceWriteAllowed,homeWriteAllowed,externalDenied,externalSocketDenied,inboundDenied,outboundDenied})+"\\n");})().catch((error)=>{console.error(error.stack||error);process.exitCode=1});',
  ].join("");
  const test = 'process.stdout.write("temp-test-ran\\n")';
  const worker = 'require("node:fs").writeFileSync("worker-configuration.d.ts","validation-generated\\n");process.stdout.write("temp-worker-ran\\n")';
  return { build: nodeScript(build), test: nodeScript(test), "worker:typecheck": nodeScript(worker) };
}
function failingValidationScripts(failedCommand, output = "validation stdout", stderr = "validation stderr") {
  const command = (name) => nodeScript(`process.stdout.write(${JSON.stringify(output)}+"\\n");process.stderr.write(${JSON.stringify(stderr)}+"\\n");process.exit(${name === failedCommand ? 1 : 0})`);
  return { build: command("npm run build"), test: command("npm test"), "worker:typecheck": command("npm run worker:typecheck") };
}
test("Claude Messages transport sends strict schema-bound tools for every role", async () => {
  assert.throws(() => new ClaudeMessagesTransport({ apiKey: "" }), /GENERAL_ANTHROPIC_API_KEY_REQUIRED/u);
  const inputs = { architect: { summary: "Add a document.", allowedPaths: ["docs/general-smoke.md"], plan: "Write one file.", acceptance: ["File exists."], constraints: [] }, builder: { summary: "Write it.", actions: ["write"], files: [{ path: "docs/general-smoke.md", content: "# Smoke\n" }] }, analyst: { decision: "PASS", findings: [] }, final: { decision: "ACCEPT", rationale: "Validated." } }; const originalFetch = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, init) => { const request = { url, init, body: JSON.parse(init.body) }; requests.push(request); const toolName = request.body.tools[0].name; const role = toolName.slice("general_".length, -"_result".length); return { ok: true, status: 200, json: async () => ({ content: [{ type: "tool_use", name: toolName, input: inputs[role] }] }) }; };
  try {
    const transport = new ClaudeMessagesTransport({ apiKey: "test-only-key" }); for (const role of ["architect", "builder", "analyst", "final"]) await transport.complete({ role, input: { instruction: "Write a document." } });
    assert.equal(requests.length, 4); for (const request of requests) { const tool = request.body.tools[0]; assert.equal(request.url, "https://api.anthropic.com/v1/messages"); assert.equal(request.init.headers["x-api-key"], "test-only-key"); assert.equal(request.init.headers["anthropic-version"], "2023-06-01"); assert.equal(tool.strict, true); assert.equal(tool.input_schema.additionalProperties, false); assert.deepEqual(request.body.tool_choice, { type: "tool", name: tool.name }); }
    const architect = requests.find((request) => request.body.tools[0].name === "general_architect_result").body; assert.equal(architect.model, "claude-sonnet-4-6"); assert.deepEqual(architect.tools[0].input_schema.required, ["summary", "allowedPaths", "plan", "acceptance", "constraints"]); assert.equal(architect.tools[0].input_schema.properties.plan.type, "string"); assert.match(architect.tools[0].input_schema.properties.plan.description, /one implementation-oriented Markdown string/iu); assert.match(architect.messages[0].content, /plan \(one Markdown string, never an array or object\)/u);
  } finally { globalThis.fetch = originalFetch; }
});

test("Architect accepts the exact multi-part plan.md instruction as one structured plan", async () => {
  const instruction = "Create plan.md for AI Agent Radar. Add this prioritized backlog: P0 Gemini 503 retry; P1 four-story daily email; P2 increase Brave Search limits to 100 per week and 350 per month, keeping the daily limit at 10; P3 broader AI and IT development coverage with priority for Codex and Claude Code; P4 fallback relevant-story email; P5 user feedback learning. Make plan.md structured and implementation-oriented.";
  const plan = "# AI Agent Radar backlog\n\n## P0 — Gemini 503 retry\nDefine bounded retries and reporting.\n\n## P1 — Daily email\nSpecify four ranked stories.\n\n## P2 — Brave Search limits\nSet weekly 100 and monthly 350 while retaining daily 10.\n\n## P3 — Coverage\nPrioritize Codex and Claude Code.\n\n## P4 — Fallback email\nDescribe relevant-story fallback selection.\n\n## P5 — Feedback learning\nDescribe bounded user-feedback learning.\n" + "Implementation detail.\n".repeat(3000);
  const architectResult = { summary: "Create an implementation-oriented AI Agent Radar backlog.", allowedPaths: ["plan.md"], plan, acceptance: ["plan.md lists P0 through P5 in priority order.", "The P2 limits preserve the daily limit of 10.", "The plan is implementation-oriented."], constraints: ["Do not implement runtime changes.", "Do not modify deployment or production configuration.", "Keep the change to plan.md."] };
  const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  const result = await runGeneralAutopilotForTest({ instruction, runtimeRoot, sourceRoot, transport: transport({ architectResult }) });
  assert.equal(result.status, "READY_FOR_INTEGRATION"); assert.deepEqual(result.changedFiles, ["plan.md"]); assert.deepEqual(result.validation.map((entry) => entry.status), [0, 0, 0]);
});

test("Architect schema remains exact and returns safe field diagnostics", async () => {
  const valid = { summary: "Create plan.", allowedPaths: ["plan.md"], plan: "# Plan\n", acceptance: ["Exists."], constraints: ["No deployment."] };
  const cases = [
    [{ ...valid, extra: "rejected" }, "EXACT_FIELDS_REQUIRED", { unexpectedFieldCount: 1 }],
    [{ summary: valid.summary, allowedPaths: valid.allowedPaths, plan: valid.plan, acceptance: valid.acceptance }, "EXACT_FIELDS_REQUIRED", { missingFields: ["constraints"] }],
    [{ ...valid, plan: ["not a string"] }, "STRING_REQUIRED", { field: "plan" }],
    [{ ...valid, summary: "API_KEY=not-a-real-key" }, "UNSAFE_CONTENT", { field: "summary" }],
  ];
  for (const [architectResult, reason, expected] of cases) {
    const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
    await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create plan.md.", runtimeRoot, sourceRoot, transport: transport({ architectResult }) }), (error) => {
      assert.equal(error.code, "GENERAL_ARCHITECT_SCHEMA"); assert.equal(error.schemaDiagnostics.role, "architect"); assert.equal(error.schemaDiagnostics.reason, reason); for (const [key, value] of Object.entries(expected)) assert.deepEqual(error.schemaDiagnostics[key], value); assert.doesNotMatch(JSON.stringify(error.schemaDiagnostics), /not-a-real-key/u); return true;
    });
  }
  const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create plan.md.", runtimeRoot, sourceRoot, transport: transport({ malformed: true }) }), (error) => error.code === "GENERAL_ARCHITECT_SCHEMA" && error.schemaDiagnostics.reason === "EXACT_FIELDS_REQUIRED");
});

test("Architect retries one safe schema repair and never makes a third Architect call", async () => {
  const oneCallSource = fixture(); const oneCallRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(oneCallRuntime); const oneCallTransport = retryTransport([validArchitectResult]);
  const oneCallResult = await runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot: oneCallRuntime, sourceRoot: oneCallSource, transport: oneCallTransport });
  assert.equal(oneCallResult.status, "READY_FOR_INTEGRATION"); assert.equal(oneCallTransport.calls.filter((call) => call.role === "architect").length, 1);

  for (const [missingFields, secret] of [[["acceptance"], "API_KEY=hidden-architect-payload"], [["constraints"], null], [["acceptance", "constraints"], null]]) {
    const first = { ...validArchitectResult }; for (const field of missingFields) delete first[field]; if (secret !== null) first.summary = secret;
    const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot); const retry = retryTransport([first, validArchitectResult]);
    const result = await runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: retry }); const architectCalls = retry.calls.filter((call) => call.role === "architect");
    assert.equal(result.status, "READY_FOR_INTEGRATION"); assert.equal(architectCalls.length, 2); assert.match(architectCalls[1].input.schemaRepair, /Your previous response did not match the required Architect schema\./u); for (const field of missingFields) assert.match(architectCalls[1].input.schemaRepair, new RegExp(`^- ${field}$`, "mu")); assert.doesNotMatch(architectCalls[1].input.schemaRepair, /hidden-architect-payload|API_KEY/u); assert.deepEqual(result.records.map((record) => record.role), ["architect", "builder", "analyst", "final"]);
  }

  const firstInvalid = { ...validArchitectResult }; delete firstInvalid.acceptance; const secondInvalid = { ...validArchitectResult }; delete secondInvalid.constraints; const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot); const failedRetry = retryTransport([firstInvalid, secondInvalid]);
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: failedRetry }), (error) => error.code === "GENERAL_ARCHITECT_SCHEMA" && error.schemaDiagnostics.reason === "EXACT_FIELDS_REQUIRED" && error.schemaDiagnostics.missingFields.join(",") === "constraints");
  assert.equal(failedRetry.calls.filter((call) => call.role === "architect").length, 2); assert.equal(failedRetry.calls.some((call) => call.role === "builder"), false);
});

test("general instruction automatically drives Architect, Builder, Analyst, and final Architect", async () => {
  const sourceRoot = fixture(); const sourceDependencies = path.join(sourceRoot, "node_modules"); const sourceSnapshot = dependencySnapshot(sourceDependencies); const result = await run({}, sourceRoot);
  assert.equal(result.status, "READY_FOR_INTEGRATION");
  assert.equal(result.iterations, 1);
  assert.deepEqual(result.records.map((item) => item.role), ["architect", "builder", "analyst", "final"]);
  assert.ok(result.trace.includes("[ARCHITECT] plan created"));
  assert.ok(result.trace.includes("[STATE] READY_FOR_INTEGRATION"));
  assert.equal(result.deployment, false); assert.equal(result.integration, false);
  assert.deepEqual(result.validation.map((item) => [item.command, item.status]), [["npm run build", 0], ["npm test", 0], ["npm run worker:typecheck", 0]]);
  assert.match(result.branch, /^autopilot\//u);
  assert.equal(git(result.sourceRoot, ["rev-parse", "self-improvement"]).stdout.trim(), result.baseline);
  const state = JSON.parse(fs.readFileSync(result.controllerStatePath, "utf8"));
  assert.equal(state.cycles[0].stage, "READY_FOR_INTEGRATION");
  assert.equal(state.receipts.length, 4);
  assert.equal(state.timings.length, 4);
  assert.equal(state.summaries.filter((item) => item.type === "FINAL").length, 1);
  assert.equal(state.summaries.at(-1).terminalReason, "GENERAL_READY_FOR_INTEGRATION");
  const copiedTsc = path.join(result.dependencyPreparation.destination, ".bin", "tsc");
  assert.equal(fs.existsSync(copiedTsc), true);
  assert.notEqual(result.dependencyPreparation.source, result.dependencyPreparation.destination);
  assert.equal(fs.readlinkSync(copiedTsc), "../typescript/bin/tsc");
  assert.equal(fs.realpathSync(copiedTsc), path.join(result.dependencyPreparation.destination, "typescript", "bin", "tsc"));
  assert.notEqual(fs.realpathSync(copiedTsc), path.join(result.sourceRoot, "node_modules", "typescript", "bin", "tsc"));
  assert.equal(fs.readlinkSync(path.join(result.sourceRoot, "node_modules", ".bin", "tsc")), "../typescript/bin/tsc");
  fs.writeFileSync(path.join(result.dependencyPreparation.destination, "typescript", "bin", "tsc"), "workspace-only\n");
  assert.equal(fs.readFileSync(path.join(result.sourceRoot, "node_modules", "typescript", "bin", "tsc"), "utf8"), "#!/bin/sh\nexit 0\n");
  assert.equal(dependencySnapshot(sourceDependencies), sourceSnapshot);
});
test("dependency preparation rejects source and destination symlink escapes", async () => {
  const sourceEscape = fixture({ dependencyLink: "escape" }); const sourceRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(sourceRuntime);
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot: sourceRuntime, sourceRoot: sourceEscape, transport: transport() }), /GENERAL_DEPENDENCY_SYMLINK_ESCAPE/u);
  assert.equal(fs.existsSync(path.join(sourceRuntime, "workspace", "node_modules")), false);
  const destinationEscape = fixture({ dependencyLink: "source-absolute" }); const destinationRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(destinationRuntime);
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot: destinationRuntime, sourceRoot: destinationEscape, transport: transport() }), /GENERAL_DEPENDENCY_SYMLINK_ESCAPE/u);
  const copiedEscape = path.join(destinationRuntime, "workspace", "node_modules", ".bin", "tsc");
  assert.equal(fs.realpathSync(copiedEscape), fs.realpathSync(path.join(destinationEscape, "node_modules", "typescript", "bin", "tsc")));
});
test("validation cleans only known generated effects and preserves evidence", async () => {
  const sourceRoot = fixture({ scripts: hygieneScripts() }); const result = await run({}, sourceRoot); const workspace = path.dirname(result.dependencyPreparation.destination);
  assert.deepEqual(result.validation.map((entry) => entry.command), ["npm run build", "npm test", "npm run worker:typecheck"]);
  assert.match(result.validation[0].output, /build-generated/u); assert.match(result.validation[1].output, /test-generated/u); assert.match(result.validation[2].output, /worker-generated/u);
  assert.equal(fs.existsSync(path.join(workspace, "dist")), false);
  assert.equal(fs.existsSync(path.join(workspace, "Library")), false);
  assert.equal(fs.existsSync(path.join(path.dirname(workspace), "validation-home")), false);
  assert.equal(fs.readFileSync(path.join(workspace, "worker-configuration.d.ts"), "utf8"), git(workspace, ["show", `${result.candidateCommit}:worker-configuration.d.ts`]).stdout);
  const status = statusPorcelain(workspace, { includeIgnored: true }).split("\0").filter(Boolean);
  assert.ok(status.length > 0 && status.every((entry) => entry.startsWith("!! node_modules/")));
});
test("sandboxed validation confines Node temporary directories to validation home", async (t) => {
  if (process.env.GOV002_FS_BOUNDARY_EVIDENCE) {
    const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "general-validation-profile-")); const workspace = path.join(runtime, "workspace"); const validationHome = path.join(runtime, "validation-home"); fs.mkdirSync(workspace); fs.mkdirSync(validationHome, { mode: 0o700 });
    const sandbox = offlineExecutorSandboxProfile({ workspaceRoot: workspace, validationHome });
    const builderSandbox = offlineExecutorSandboxProfile({ workspaceRoot: workspace });
    assert.match(sandbox.profile, /\(deny file-write\*\)/u); assert.match(sandbox.profile, /\(allow network\* \(local unix-socket\)\)/u); assert.doesNotMatch(builderSandbox.profile, /\(allow network\* \(local unix-socket\)\)/u); assert.ok(sandbox.profile.includes(sandbox.roots.validationHomeRoot.canonicalRoot)); assert.equal(sandbox.roots.validationHomeRoot.mode, "0700");
    t.skip("the offline wrapper already runs under sandbox-exec and cannot nest validation confinement"); return;
  }
  const externalPath = "/private/tmp/general-autopilot-validation-temp-denied"; assert.equal(fs.existsSync(externalPath), false);
  const sourceRoot = fixture({ scripts: validationTempScripts(externalPath) }); const runtimeRoot = fs.mkdtempSync("/private/tmp/general-runtime-"); fs.rmdirSync(runtimeRoot);
  const result = await runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: transport(), sandboxedValidation: true }); const workspace = path.dirname(result.dependencyPreparation.destination);
  const report = JSON.parse(result.validation[0].output.split(/\r?\n/u).find((line) => line.startsWith("TEMP_REPORT:"))?.slice("TEMP_REPORT:".length) ?? "");
  assert.equal(report.tmp, path.join(path.dirname(workspace), "validation-home", "tmp")); assert.equal(report.tmpdir, report.tmp); assert.equal(report.tmpEnv, report.tmp); assert.equal(report.tmpVariable, report.tmp); assert.equal(report.mode, 0o700); assert.equal(path.dirname(report.socketPath), report.tmp); assert.match(path.basename(report.socketPath), /^tsx-\d+\.pipe$/u); assert.equal(report.socketRemoved, true); assert.equal(report.workspaceWriteAllowed, true); assert.equal(report.homeWriteAllowed, true); assert.equal(report.externalDenied, true); assert.equal(report.externalSocketDenied, true); assert.equal(report.inboundDenied, true); assert.equal(report.outboundDenied, true);
  assert.equal(fs.existsSync(externalPath), false); assert.equal(fs.existsSync(`${externalPath}.socket`), false); assert.equal(fs.existsSync(path.join(path.dirname(workspace), "validation-home")), false);
  const status = statusPorcelain(workspace, { includeIgnored: true }).split("\0").filter(Boolean); assert.ok(status.length > 0 && status.every((entry) => entry.startsWith("!! node_modules/")));
});
test("validation failures report the reviewed command, bounded output, and redacted diagnostics", async () => {
  for (const [command, step] of [["npm run build", 1], ["npm test", 2], ["npm run worker:typecheck", 3]]) {
    const sourceRoot = fixture({ scripts: failingValidationScripts(command) }); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
    await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: transport() }), (error) => {
      assert.equal(error.code, "GENERAL_VALIDATION_FAILED"); assert.deepEqual(error.failedValidations.map((item) => [item.step, item.command, item.status, item.timedOut]), [[step, command, 1, false]]); assert.match(error.failedValidations[0].output, /validation stdout/u); assert.match(error.failedValidations[0].output, /validation stderr/u); return true;
    });
  }
  const sourceRoot = fixture({ scripts: failingValidationScripts("npm test", "x".repeat(17000)) }); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: transport() }), (error) => {
    const diagnostic = error.failedValidations[0]; assert.equal(diagnostic.command, "npm test"); assert.ok(diagnostic.output.length <= 16000); return true;
  });
  const secretSource = fixture({ scripts: failingValidationScripts("npm test", "validation stdout", "ANTHROPIC_API_KEY=super-secret-value sk-proj-very-secret-value") }); const secretRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(secretRuntime);
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot: secretRuntime, sourceRoot: secretSource, transport: transport() }), (error) => {
    const diagnostic = error.failedValidations[0]; assert.match(diagnostic.output, /\[REDACTED\]/u); assert.doesNotMatch(diagnostic.output, /super-secret-value|sk-proj-very-secret-value/u); return true;
  });
  const pem = "x".repeat(15_900) + "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----"; const pemSource = fixture({ scripts: failingValidationScripts("npm test", pem) }); const pemRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(pemRuntime);
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot: pemRuntime, sourceRoot: pemSource, transport: transport() }), (error) => {
    const diagnostic = error.failedValidations[0]; assert.ok(diagnostic.output.length <= 16000); assert.match(diagnostic.output, /\[REDACTED_PRIVATE_KEY\]/u); assert.doesNotMatch(diagnostic.output, /private-key-material|BEGIN PRIVATE KEY/u); return true;
  });
});
test("validation timeout remains an execution-limit path after cleanup", () => {
  const source = fs.readFileSync(new URL("../src/general-autopilot.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(timedOut\) haltForLimit\(\{ statePath, ownerId, taskId: task\.taskId, code: limitCode\(task\) \}\)/u);
});
test("validation fails closed on unexpected tracked or untracked output and dependency mutation", async () => {
  const cases = [
    { scripts: hygieneScripts({ tracked: "README.md" }), ignoredPaths: "node_modules/\n", code: /GENERAL_VALIDATION_UNEXPECTED_WORKSPACE_MUTATION/u },
    { scripts: hygieneScripts({ unexpected: "unexpected-untracked/output" }), ignoredPaths: "node_modules/\n", code: /GENERAL_VALIDATION_UNEXPECTED_WORKSPACE_MUTATION/u },
    { scripts: hygieneScripts({ unexpected: "unexpected-ignored/output" }), ignoredPaths: "node_modules/\nunexpected-ignored/\n", code: /GENERAL_VALIDATION_UNEXPECTED_WORKSPACE_MUTATION/u },
    { scripts: hygieneScripts({ mutateDependency: true }), ignoredPaths: "node_modules/\n", code: /GENERAL_DEPENDENCY_TREE_MUTATED/u },
  ];
  for (const item of cases) {
    const sourceRoot = fixture({ scripts: item.scripts, ignoredPaths: item.ignoredPaths }); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
    await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: transport() }), item.code);
  }
});
test("Analyst REVISE is returned directly to Builder iteration two", async () => {
  const result = await run({ revise: true });
  assert.equal(result.status, "READY_FOR_INTEGRATION");
  assert.equal(result.iterations, 2);
  assert.deepEqual(result.records.map((item) => item.role), ["architect", "builder", "analyst", "builder", "analyst", "final"]);
  assert.equal(result.analyst, "PASS");
  const state = JSON.parse(fs.readFileSync(result.controllerStatePath, "utf8"));
  assert.deepEqual(state.tasks.map((item) => item.purpose), ["ARCHITECT_PLAN", "BUILDER_IMPLEMENTATION", "ANALYST_REVIEW", "BUILDER_IMPLEMENTATION", "ANALYST_REVIEW", "ARCHITECT_FINAL_DECISION"]);
});
test("sandboxed validation cannot write authority, controller, or protected target paths", async () => {
  const attempts = [path.join(PRODUCTION_AUTHORITY_ROOT, "general-validation-denied"), path.join(PRODUCTION_CONTROLLER_ROOT, "general-validation-denied"), path.join(PROTECTED_REAL_TARGET_ROOT, "general-validation-denied")];
  assert.ok(attempts.every((file) => !fs.existsSync(file)));
  const command = (file) => `node -e 'require("node:fs").writeFileSync(${JSON.stringify(file)}, "denied")'`;
  const sourceRoot = fixture({ scripts: { build: command(attempts[0]), test: command(attempts[1]), "worker:typecheck": command(attempts[2]) } }); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: transport(), sandboxedValidation: true }), /GENERAL_VALIDATION_FAILED/u);
  assert.ok(attempts.every((file) => !fs.existsSync(file)));
});
test("malformed model output and target overrides fail closed", async () => {
  const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: transport({ malformed: true }) }), /GENERAL_ARCHITECT_SCHEMA/u);
  const state = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "general-controller-state.json"), "utf8"));
  assert.equal(state.activeCycleId, null);
  assert.equal(state.cycles[0].status, "HALTED");
  assert.equal(state.cycles[0].stage, "FAILED");
});
test("controller rejects protected configuration paths before Builder execution", async () => {
  const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  const unsafeTransport = { async complete({ role }) {
    if (role === "architect") return { summary: "Unsafe.", allowedPaths: ["wrangler.toml"], plan: "Mutate deployment configuration.", acceptance: ["No."], constraints: [] };
    throw new Error("Builder must not run");
  }};
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Change deployment.", runtimeRoot, sourceRoot, transport: unsafeTransport }), /GENERAL_ARCHITECT_SCHEMA/u);
});
test("Builder content containing credential material fails before the executor", async () => {
  const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  const unsafeTransport = { async complete({ role }) {
    if (role === "architect") return { summary: "Unsafe.", allowedPaths: ["docs/general-smoke.md"], plan: "Write a file.", acceptance: ["No secrets."], constraints: [] };
    if (role === "builder") return { summary: "Unsafe.", actions: ["write"], files: [{ path: "docs/general-smoke.md", content: "API_KEY=not-a-real-key\n" }] };
    throw new Error("Analyst must not run");
  }};
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Write a secret.", runtimeRoot, sourceRoot, transport: unsafeTransport }), /GENERAL_BUILDER_FILE_INVALID/u);
});
test("credential-shaped instruction and model text never enter a subsequent prompt", async () => {
  const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Use API_KEY=not-a-real-key", runtimeRoot, sourceRoot, transport: transport() }), /GENERAL_INSTRUCTION_REQUIRED/u);
  const outputRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(outputRuntime);
  const unsafeTransport = { async complete({ role }) {
    if (role === "architect") return { summary: "Unsafe API_KEY=not-a-real-key", allowedPaths: ["docs/general-smoke.md"], plan: "Write a file.", acceptance: [], constraints: [] };
    throw new Error("Later role must not run");
  }};
  await assert.rejects(runGeneralAutopilotForTest({ instruction: "Write a document.", runtimeRoot: outputRuntime, sourceRoot, transport: unsafeTransport }), /GENERAL_ARCHITECT_SCHEMA/u);
});
test("third unresolved Analyst review terminates without final acceptance", async () => {
  let attempt = 0; const neverPass = { async complete({ role }) {
    if (role === "architect") return { summary: "Add a harmless document.", allowedPaths: ["docs/general-smoke.md"], plan: "Write one documentation file.", acceptance: ["File exists."], constraints: ["No deployment."] };
    if (role === "builder") { attempt += 1; return { summary: "Write a document.", actions: ["write docs/general-smoke.md"], files: [{ path: "docs/general-smoke.md", content: "iteration " + attempt + "\n" }] }; }
    if (role === "analyst") return { decision: "REVISE", findings: ["Still incomplete."] };
    return { decision: "REJECT", rationale: "A third REVISE cannot be accepted." };
  }};
  const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  const result = await runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: neverPass });
  assert.equal(result.status, "REJECTED"); assert.equal(result.iterations, 3); assert.equal(result.architect, "REJECT");
  const state = JSON.parse(fs.readFileSync(result.controllerStatePath, "utf8")); assert.equal(state.activeCycleId, null); assert.equal(state.cycles[0].status, "REJECTED");
});
test("Builder executor rejects Git metadata and path traversal", () => {
  const executor = fs.readFileSync(new URL("../src/general-builder-executor.mjs", import.meta.url), "utf8");
  assert.match(executor, /GENERAL_BUILDER_PATH_ESCAPE/u);
  assert.match(executor, /startsWith\("\.git\/"\)/u);
  assert.match(executor, /GENERAL_BUILDER_SYMLINK_OR_NON_DIRECTORY/u);
});
test("restricted Builder executor records direct and descendant macOS confinement", (t) => {
  if (process.env.GOV002_FS_BOUNDARY_EVIDENCE) { t.skip("the offline wrapper already runs under a confinement sandbox that cannot nest sandbox-exec"); return; }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "general-executor-"));
  const sandbox = offlineExecutorSandboxProfile({ workspaceRoot: workspace });
  const env = { GENERAL_WORKSPACE_ROOT: workspace, GENERAL_BOUNDARY_ROOTS: JSON.stringify(Object.fromEntries(Object.entries(sandbox.roots).map(([name, root]) => [name, root.canonicalRoot]))), GENERAL_POLICY_DIGEST: sandbox.digest, PATH: "/usr/bin:/bin:/usr/local/bin", HOME: workspace };
  const result = spawnSync("/usr/bin/sandbox-exec", ["-p", sandbox.profile, "/usr/local/bin/node", path.resolve("src/general-builder-executor.mjs")], { cwd: workspace, input: JSON.stringify({ files: [{ path: "docs/executor-smoke.md", content: "# confined\n" }] }), encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.confinement.mechanism, "MACOS_SANDBOX_CHECK");
  assert.equal(output.confinement.policyDigest, sandbox.digest);
  assert.equal(output.confinement.records.length, 14);
  assert.ok(output.confinement.records.every((item) => (item.operation.includes("workspace") ? item.observedPermission === "ALLOWED" : item.observedPermission === "DENIED")));
});
