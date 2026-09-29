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
function transport({ revise = false, malformed = false } = {}) {
  let builder = 0; let analyst = 0;
  return { async complete({ role }) {
    if (malformed && role === "architect") return { nope: true };
    if (role === "architect") return { summary: "Add a harmless document.", allowedPaths: ["docs/general-smoke.md"], plan: "Write one documentation file.", acceptance: ["File exists."], constraints: ["No deployment."] };
    if (role === "builder") { builder += 1; return { summary: "Write the approved document.", actions: ["write docs/general-smoke.md"], files: [{ path: "docs/general-smoke.md", content: "# General smoke\n\nIteration " + builder + "\n" }] }; }
    if (role === "analyst") { analyst += 1; return revise && analyst === 1 ? { decision: "REVISE", findings: ["Clarify the document."] } : { decision: "PASS", findings: [] }; }
    return { decision: "ACCEPT", rationale: "Validated candidate is acceptable." };
  }};
}
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
  const build = `const fs=require("node:fs"),os=require("node:os"),path=require("node:path");const tmp=os.tmpdir();if(tmp!==process.env.TMPDIR||tmp!==process.env.TMP||tmp!==process.env.TEMP||tmp!==path.join(process.env.HOME,"tmp"))throw new Error("TEMP_ENV_MISMATCH");const probe=fs.mkdtempSync(path.join(tmp,"general-autopilot-probe-"));fs.writeFileSync(path.join(probe,"probe"),"ok");fs.rmSync(probe,{recursive:true,force:true});let externalDenied=false;try{fs.writeFileSync(${JSON.stringify(externalPath)},"forbidden")}catch(error){externalDenied=["EPERM","EACCES"].includes(error.code)}if(!externalDenied)throw new Error("EXTERNAL_TEMP_WRITE_ALLOWED");process.stdout.write("TEMP_REPORT:"+JSON.stringify({tmp,tmpdir:os.tmpdir(),tmpEnv:process.env.TMP,tmpVariable:process.env.TEMP,mode:fs.statSync(tmp).mode&0o7777,externalDenied})+"\\n")`;
  const test = 'process.stdout.write("temp-test-ran\\n")';
  const worker = 'require("node:fs").writeFileSync("worker-configuration.d.ts","validation-generated\\n");process.stdout.write("temp-worker-ran\\n")';
  return { build: nodeScript(build), test: nodeScript(test), "worker:typecheck": nodeScript(worker) };
}
test("Claude Messages transport forces one schema-bound tool result", async () => {
  assert.throws(() => new ClaudeMessagesTransport({ apiKey: "" }), /GENERAL_ANTHROPIC_API_KEY_REQUIRED/u);
  const originalFetch = globalThis.fetch; let request;
  globalThis.fetch = async (url, init) => { request = { url, init }; return { ok: true, status: 200, json: async () => ({ content: [{ type: "tool_use", name: "general_architect_result", input: { summary: "Add a document.", allowedPaths: ["docs/general-smoke.md"], plan: "Write one file.", acceptance: ["File exists."], constraints: [] } }] }) }; };
  try {
    const transport = new ClaudeMessagesTransport({ apiKey: "test-only-key" }); const result = await transport.complete({ role: "architect", input: { instruction: "Write a document." } });
    assert.equal(request.url, "https://api.anthropic.com/v1/messages"); assert.equal(request.init.headers["x-api-key"], "test-only-key"); assert.equal(request.init.headers["anthropic-version"], "2023-06-01");
    const body = JSON.parse(request.init.body); assert.equal(body.model, "claude-sonnet-4-6"); assert.deepEqual(body.tool_choice, { type: "tool", name: "general_architect_result" }); assert.deepEqual(result.allowedPaths, ["docs/general-smoke.md"]);
  } finally { globalThis.fetch = originalFetch; }
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
    assert.match(sandbox.profile, /\(deny file-write\*\)/u); assert.ok(sandbox.profile.includes(sandbox.roots.validationHomeRoot.canonicalRoot)); assert.equal(sandbox.roots.validationHomeRoot.mode, "0700");
    t.skip("the offline wrapper already runs under sandbox-exec and cannot nest validation confinement"); return;
  }
  const externalPath = "/private/tmp/general-autopilot-validation-temp-denied"; assert.equal(fs.existsSync(externalPath), false);
  const sourceRoot = fixture({ scripts: validationTempScripts(externalPath) }); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  const result = await runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: transport(), sandboxedValidation: true }); const workspace = path.dirname(result.dependencyPreparation.destination);
  const report = JSON.parse(result.validation[0].output.split(/\r?\n/u).find((line) => line.startsWith("TEMP_REPORT:"))?.slice("TEMP_REPORT:".length) ?? "");
  assert.equal(report.tmp, path.join(path.dirname(workspace), "validation-home", "tmp")); assert.equal(report.tmpdir, report.tmp); assert.equal(report.tmpEnv, report.tmp); assert.equal(report.tmpVariable, report.tmp); assert.equal(report.mode, 0o700); assert.equal(report.externalDenied, true);
  assert.equal(fs.existsSync(externalPath), false); assert.equal(fs.existsSync(path.join(path.dirname(workspace), "validation-home")), false);
  const status = statusPorcelain(workspace, { includeIgnored: true }).split("\0").filter(Boolean); assert.ok(status.length > 0 && status.every((entry) => entry.startsWith("!! node_modules/")));
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
