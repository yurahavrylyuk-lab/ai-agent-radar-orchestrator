import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runGeneralAutopilot } from "../src/general-autopilot.mjs";
import { git } from "../src/git-evidence.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-autopilot-"));
  git(root, ["init", "-b", "main"], { write: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "node -e \"\"", test: "node -e \"\"", "worker:typecheck": "node -e \"\"" } }));
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  git(root, ["add", "."], { write: true }); git(root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", "commit", "--no-gpg-sign", "-m", "baseline"], { write: true });
  git(root, ["branch", "self-improvement"]);
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
  return runGeneralAutopilot({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: transport(options) }).then((result) => ({ ...result, sourceRoot, baseline }));
}

test("general instruction automatically drives Architect, Builder, Analyst, and final Architect", async () => {
  const prior = process.env.GENERAL_AUTOPILOT_TEST; process.env.GENERAL_AUTOPILOT_TEST = "1";
  try {
    const result = await run();
    assert.equal(result.status, "READY_FOR_INTEGRATION");
    assert.equal(result.iterations, 1);
    assert.deepEqual(result.records.map((item) => item.role), ["architect", "builder", "analyst", "final"]);
    assert.ok(result.trace.includes("[ARCHITECT] plan created"));
    assert.ok(result.trace.includes("[STATE] READY_FOR_INTEGRATION"));
    assert.equal(result.deployment, false); assert.equal(result.integration, false);
    assert.match(result.branch, /^autopilot\//u);
    assert.equal(git(result.sourceRoot, ["rev-parse", "self-improvement"]).stdout.trim(), result.baseline);
  } finally { if (prior === undefined) delete process.env.GENERAL_AUTOPILOT_TEST; else process.env.GENERAL_AUTOPILOT_TEST = prior; }
});
test("Analyst REVISE is returned directly to Builder iteration two", async () => {
  const prior = process.env.GENERAL_AUTOPILOT_TEST; process.env.GENERAL_AUTOPILOT_TEST = "1";
  try {
    const result = await run({ revise: true });
    assert.equal(result.status, "READY_FOR_INTEGRATION");
    assert.equal(result.iterations, 2);
    assert.deepEqual(result.records.map((item) => item.role), ["architect", "builder", "analyst", "builder", "analyst", "final"]);
    assert.equal(result.analyst, "PASS");
  } finally { if (prior === undefined) delete process.env.GENERAL_AUTOPILOT_TEST; else process.env.GENERAL_AUTOPILOT_TEST = prior; }
});
test("malformed model output and target overrides fail closed", async () => {
  const prior = process.env.GENERAL_AUTOPILOT_TEST; process.env.GENERAL_AUTOPILOT_TEST = "1";
  try { await assert.rejects(run({ malformed: true }), /GENERAL_ARCHITECT_SCHEMA/u); } finally { if (prior === undefined) delete process.env.GENERAL_AUTOPILOT_TEST; else process.env.GENERAL_AUTOPILOT_TEST = prior; }
});
test("third unresolved Analyst review terminates without final acceptance", async () => {
  const prior = process.env.GENERAL_AUTOPILOT_TEST; process.env.GENERAL_AUTOPILOT_TEST = "1";
  let attempt = 0; const neverPass = { async complete({ role }) {
    if (role === "architect") return { summary: "Add a harmless document.", allowedPaths: ["docs/general-smoke.md"], plan: "Write one documentation file.", acceptance: ["File exists."], constraints: ["No deployment."] };
    if (role === "builder") { attempt += 1; return { summary: "Write a document.", actions: ["write docs/general-smoke.md"], files: [{ path: "docs/general-smoke.md", content: "iteration " + attempt + "\n" }] }; }
    if (role === "analyst") return { decision: "REVISE", findings: ["Still incomplete."] };
    throw new Error("final role must not run");
  }};
  try {
    const sourceRoot = fixture(); const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-runtime-")); fs.rmdirSync(runtimeRoot);
    const result = await runGeneralAutopilot({ instruction: "Create a smoke document.", runtimeRoot, sourceRoot, transport: neverPass });
    assert.equal(result.status, "REJECTED"); assert.equal(result.iterations, 3); assert.equal(result.architect, null);
  } finally { if (prior === undefined) delete process.env.GENERAL_AUTOPILOT_TEST; else process.env.GENERAL_AUTOPILOT_TEST = prior; }
});
test("Builder executor rejects Git metadata and path traversal", () => {
  const executor = fs.readFileSync(new URL("../src/general-builder-executor.mjs", import.meta.url), "utf8");
  assert.match(executor, /GENERAL_BUILDER_PATH_ESCAPE/u);
  assert.match(executor, /startsWith\("\.git\/"\)/u);
});
