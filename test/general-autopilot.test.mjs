import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ClaudeMessagesTransport, runGeneralAutopilotForTest } from "../src/general-autopilot.mjs";
import { git } from "../src/git-evidence.mjs";
import { offlineExecutorSandboxProfile, PRODUCTION_AUTHORITY_ROOT, PRODUCTION_CONTROLLER_ROOT, PROTECTED_REAL_TARGET_ROOT } from "../src/operator-boundary.mjs";

function fixture({ scripts = { build: "tsc", test: "node -e \"\"", "worker:typecheck": "tsc" } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-autopilot-"));
  git(root, ["init", "-b", "main"], { write: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ name: "general-autopilot-fixture", lockfileVersion: 3, requires: true, packages: {} }));
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  git(root, ["add", "."], { write: true }); git(root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", "commit", "--no-gpg-sign", "-m", "baseline"], { write: true });
  git(root, ["branch", "self-improvement"]); fs.mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true }); const tsc = path.join(root, "node_modules", ".bin", "tsc"); fs.writeFileSync(tsc, "#!/bin/sh\nexit 0\n", { mode: 0o755 }); fs.chmodSync(tsc, 0o755);
  return root;
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
function run(options = {}) {
  const sourceRoot = fixture(); const baseline = git(sourceRoot, ["rev-parse", "self-improvement"]).stdout.trim(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
  return runGeneralAutopilotForTest({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: transport(options) }).then((result) => ({ ...result, sourceRoot, baseline }));
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
  const result = await run();
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
  assert.equal(fs.existsSync(path.join(result.dependencyPreparation.destination, ".bin", "tsc")), true);
  assert.notEqual(result.dependencyPreparation.source, result.dependencyPreparation.destination);
  assert.equal(fs.readFileSync(path.join(result.sourceRoot, "node_modules", ".bin", "tsc"), "utf8"), "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(path.join(result.dependencyPreparation.destination, ".bin", "tsc"), "workspace-only\n");
  assert.equal(fs.readFileSync(path.join(result.sourceRoot, "node_modules", ".bin", "tsc"), "utf8"), "#!/bin/sh\nexit 0\n");
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
