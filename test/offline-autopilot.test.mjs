import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { OfflineFixtureTransport } from "../src/adapters/offline-fixture.mjs";
import { assertOfflineRuntimeRootGuard, createOfflineRuntimeRootGuard, prepareOfflineRuntimeRoot } from "../src/autopilot.mjs";
import { git } from "../src/git-evidence.mjs";
import { OFFLINE_FIXTURE_GOOD_CONTENT, validateOfflineFixtureTemplate } from "../src/offline-fixture-content.mjs";
import { PRODUCTION_AUTHORITY_ROOT, PROTECTED_REAL_TARGET_ROOT } from "../src/operator-boundary.mjs";
import { MAX_FRAME_BYTES, createExecutionFrame, decodeExecutionFrame, encodeExecutionFrame, validateExecutionFrame } from "../src/role-execution-protocol.mjs";
import { validateExecutionJournal } from "../src/role-execution.mjs";
import { captureTargetSnapshot, compareTargetSnapshots } from "../src/target-snapshot.mjs";
import { executedValidationEntries, inspectOfflineCandidate } from "../src/validation-evidence.mjs";
import { submitRoleResult } from "../src/result-submission.mjs";
import { validateRoleResultV2 } from "../src/validate.mjs";

function load(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function uniqueRuntime(name, parent = "/private/tmp") { return path.join(parent, `gov002-v1-${name}-${process.pid}-${crypto.randomUUID()}`); }
function evidence() { const file = process.env.GOV002_OFFLINE_AUTOPILOT_EVIDENCE; assert.ok(file, "offline autopilot evidence path must be supplied by scripts/test-offline.sh"); return load(file); }
function artifacts(name, complete = true) { const root = evidence().roots[name]; const value = { root, state: load(path.join(root, "controller-state.json")), journal: load(path.join(root, "execution-journal.json")), status: load(path.join(root, "offline-status.json")) }; if (complete) { value.summary = load(path.join(root, "offline-summary.json")); value.result = load(path.join(root, "result.json")); } return value; }
function commitFixture({ content = OFFLINE_FIXTURE_GOOD_CONTENT, mode = 0o644, extra = false, omit = false } = {}) {
  const root = uniqueRuntime("candidate"); fs.mkdirSync(root); git(root, ["init", "-b", "main"], { write: true }); fs.writeFileSync(path.join(root, "README.md"), "baseline\n"); git(root, ["add", "README.md"], { write: true }); git(root, ["-c", "user.name=Fixture", "-c", "user.email=offline@example.invalid", "commit", "--no-gpg-sign", "-m", "baseline"], { write: true }); const baseline = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  if (!omit) { const relative = "docs/learning/offline-fixture-reading.md"; const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); fs.chmodSync(file, mode); git(root, ["add", relative], { write: true }); }
  if (extra || omit) { fs.writeFileSync(path.join(root, "extra.txt"), "extra\n"); git(root, ["add", "extra.txt"], { write: true }); }
  git(root, ["-c", "user.name=Fixture", "-c", "user.email=offline@example.invalid", "commit", "--no-gpg-sign", "-m", "candidate"], { write: true }); return { root, baseline, candidate: git(root, ["rev-parse", "HEAD"]).stdout.trim() };
}

test("offline protocol rejects malformed, oversized, stale, cross-task, and digest-invalid frames", () => {
  const taskDigest = "a".repeat(64); const frame = createExecutionFrame({ executionId: "execution:test", taskDigest, sequence: 0, type: "role_result", payload: { ok: true } }); assert.equal(validateExecutionFrame(frame, { executionId: "execution:test", taskDigest, expectedSequence: 0 }), true);
  assert.throws(() => decodeExecutionFrame(Buffer.from("not-a-frame")), /FRAME_PREFIX_INVALID/u); assert.throws(() => decodeExecutionFrame(Buffer.from(`${MAX_FRAME_BYTES + 1}:`)), /FRAME_TOO_LARGE/u); assert.throws(() => validateExecutionFrame({ ...frame, frameDigest: "0".repeat(64) }), /FRAME_DIGEST_MISMATCH/u); assert.throws(() => validateExecutionFrame(frame, { executionId: "execution:wrong" }), /FRAME_EXECUTION_MISMATCH/u); assert.throws(() => validateExecutionFrame(frame, { taskDigest: "b".repeat(64) }), /FRAME_TASK_MISMATCH/u); assert.deepEqual(decodeExecutionFrame(encodeExecutionFrame(frame), { executionId: "execution:test", taskDigest }), frame);
});

test("offline fixture transport remains deterministic and has no provider or network imports", () => {
  assert.throws(() => new OfflineFixtureTransport({ scenario: "unknown" }), /OFFLINE_SCENARIO_UNSUPPORTED/u); const source = fs.readFileSync(new URL("../src/adapters/offline-fixture.mjs", import.meta.url), "utf8"); assert.doesNotMatch(source, /node:(?:fs|child_process|net|http|https)|\bfetch\s*\(/u); assert.doesNotMatch(source, /(?:OpenAI|Anthropic|Gemini|Claude|Codex App Server)/iu);
});

test("fresh-runtime policy rejects symlink, regular file, directory, and every restart", () => {
  const symlink = uniqueRuntime("symlink"); const external = fs.mkdtempSync("/private/tmp/gov002-v1-external-"); const regular = uniqueRuntime("regular"); const directory = uniqueRuntime("directory");
  try { fs.symlinkSync(external, symlink); fs.writeFileSync(regular, "x"); fs.mkdirSync(directory); assert.throws(() => prepareOfflineRuntimeRoot(symlink), /RUNTIME_SYMLINK_LEAF/u); assert.throws(() => prepareOfflineRuntimeRoot(regular), /RUNTIME_LEAF_EXISTS/u); assert.throws(() => prepareOfflineRuntimeRoot(directory), /RUNTIME_LEAF_EXISTS/u); assert.deepEqual(fs.readdirSync(external), []); } finally { fs.rmSync(symlink, { force: true }); fs.rmSync(external, { recursive: true, force: true }); fs.rmSync(regular, { force: true }); fs.rmSync(directory, { recursive: true, force: true }); }
  const failed = artifacts("failed", false); assert.equal(failed.status.phase, "FAILED"); assert.match(evidence().outcomes.failedRestart, /RUNTIME_LEAF_EXISTS/u);
});

test("runtime root is a fresh canonical direct child and identity drift is detected", () => {
  const runtime = uniqueRuntime("fresh", "/tmp"); const guard = createOfflineRuntimeRootGuard(runtime); assert.equal(guard.root, fs.realpathSync(runtime)); assert.equal(path.dirname(guard.root), fs.realpathSync("/private/tmp")); assert.equal(fs.lstatSync(runtime).mode & 0o7777, 0o700);
  const displaced = `${runtime}-old`; fs.renameSync(runtime, displaced); fs.mkdirSync(runtime); assert.throws(() => assertOfflineRuntimeRootGuard(guard), /RUNTIME_IDENTITY_DRIFT/u); fs.rmSync(runtime, { recursive: true, force: true }); fs.rmSync(displaced, { recursive: true, force: true });
});

test("success scenario automatically reaches READY_FOR_INTEGRATION in one iteration", () => {
  const item = artifacts("success"); assert.equal(item.result.status, "READY_FOR_INTEGRATION"); assert.equal(item.summary.status, "READY_FOR_INTEGRATION"); assert.equal(item.status.phase, "READY_FOR_INTEGRATION"); assert.equal(item.state.cycles[0].iteration, 1); assert.equal(item.state.cycles[0].architectDecision, "ACCEPT"); assert.deepEqual(item.journal.executions.map((record) => record.purpose), ["ARCHITECT_PLAN", "BUILDER_IMPLEMENTATION", "ANALYST_REVIEW", "ARCHITECT_FINAL_DECISION"]); assert.ok(item.journal.executions.every((record) => record.status === "SUBMITTED")); assert.equal(item.state.integrationIntents.length, 0); assert.equal(item.state.integrationOutcomes.length, 0);
});

test("revision scenario derives genuine REVISE from evidence and accepts iteration two", () => {
  const item = artifacts("revision"); const analysts = item.journal.executions.filter((record) => record.purpose === "ANALYST_REVIEW"); assert.equal(analysts.length, 2); assert.equal(analysts[0].result.payload.reviewState, "REVISE"); assert.equal(analysts[0].result.payload.validation.find((entry) => entry.recipeId === "validate-fictional-offline-content").outcome, "FAIL"); assert.equal(analysts[1].result.payload.reviewState, "PASS"); assert.ok(analysts[1].result.payload.validation.every((entry) => entry.outcome === "PASS")); assert.equal(item.state.cycles[0].iteration, 2); assert.equal(item.state.cycles[0].architectDecision, "ACCEPT"); assert.equal(item.summary.status, "READY_FOR_INTEGRATION");
});

test("Builder records real direct and descendant confinement before CONFINEMENT_VERIFIED", () => {
  const builder = artifacts("success").journal.executions.find((record) => record.role === "builder"); const records = builder.confinementEvidence.records;
  for (const context of ["executor", "descendant"]) { const map = new Map(records.filter((item) => item.context === context).map((item) => [item.operation, item.observedPermission])); assert.equal(map.get("authority-read"), "DENIED"); assert.equal(map.get("authority-write"), "DENIED"); assert.equal(map.get("controller-write"), "DENIED"); assert.equal(map.get("target-write"), "DENIED"); assert.equal(map.get("workspace-write"), "ALLOWED"); assert.equal(map.get("network-inbound"), "DENIED"); assert.equal(map.get("network-outbound"), "DENIED"); }
  assert.equal(builder.confinementEvidence.protectedPathMutationAttempts, 0); assert.deepEqual(builder.transitions.map((item) => item.status), ["PREPARING", "CONFINEMENT_VERIFIED", "EXECUTING", "RESULT_CAPTURED", "EXECUTION_FINISHED", "SUBMITTED"]); assert.equal("actualProcessEvidencePending" in builder.confinementEvidence, false);
});

test("candidate validation is bound to immutable Git object even after workspace mutation", () => {
  const item = artifacts("success"); const record = item.journal.executions.find((candidate) => candidate.purpose === "BUILDER_IMPLEMENTATION"); const task = item.state.tasks.find((candidate) => candidate.taskId === record.taskId); const workspace = item.state.workspaces.find((candidate) => candidate.taskId === task.taskId); fs.writeFileSync(path.join(workspace.root, "docs/learning/offline-fixture-reading.md"), "bad mutable workspace bytes\n"); const rerun = executedValidationEntries(item.state, task, record.executionId); assert.ok(rerun.every((entry) => entry.outcome === "PASS"));
  for (const entry of record.result.payload.validation) { const object = git(workspace.root, ["rev-parse", `${entry.evidence.candidateCommit}:docs/learning/offline-fixture-reading.md`]).stdout.trim(); assert.equal(entry.evidence.blobObjectId, object); const bytes = Buffer.from(git(workspace.root, ["cat-file", "blob", object]).stdout); assert.equal(entry.evidence.blobDigest, crypto.createHash("sha256").update(bytes).digest("hex")); assert.equal(entry.evidence.mode, "100644"); }
});

test("exact candidate validation rejects extra file, wrong mode, missing path, and unrecognized or prohibited content", () => {
  const extra = commitFixture({ extra: true }); const extraEvidence = inspectOfflineCandidate(extra.root, extra.baseline, extra.candidate); assert.equal(extraEvidence.outcomes["validate-exact-add-scope"], false); assert.equal(extraEvidence.outcomes["validate-fictional-offline-content"], true);
  const wrongMode = commitFixture({ mode: 0o755 }); assert.throws(() => inspectOfflineCandidate(wrongMode.root, wrongMode.baseline, wrongMode.candidate), /FILE_TYPE_OR_MODE_INVALID/u);
  const missing = commitFixture({ omit: true }); assert.throws(() => inspectOfflineCandidate(missing.root, missing.baseline, missing.candidate), /CANDIDATE_PATH_MISSING/u);
  const prohibited = commitFixture({ content: "fictional offline educational provider deployment billing operational instructions\n" }); const prohibitedEvidence = inspectOfflineCandidate(prohibited.root, prohibited.baseline, prohibited.candidate); assert.equal(prohibitedEvidence.outcomes["validate-fictional-offline-content"], false); assert.equal(prohibitedEvidence.outcomes["validate-prohibited-content-absence"], false); assert.equal(validateOfflineFixtureTemplate("fictional offline educational unknown content"), false);
});

test("real monotonic timing is measured and public CLI rejects time injection", () => {
  const item = artifacts("timed"); assert.equal(item.journal.executions[0].timing.activeMs, 25); assert.equal(item.journal.executions[0].activeNs, "25000000"); const runtime = uniqueRuntime("clock-cli"); const result = spawnSync("/usr/local/bin/node", ["src/cli.mjs", "autopilot-offline", "--runtime", runtime, "--now", "2026-09-28T00:00:00.000Z"], { cwd: process.cwd(), encoding: "utf8" }); assert.notEqual(result.status, 0); assert.match(result.stderr, /OFFLINE_AUTOPILOT_TIME_OVERRIDE_FORBIDDEN/u); assert.equal(fs.existsSync(runtime), false);
});

test("actual Builder timeout terminates the child before fixture write and marks runtime FAILED", () => {
  const item = artifacts("timeout", false); assert.match(evidence().outcomes.timeout, /OFFLINE_ROLE_DEADLINE_EXCEEDED/u); assert.equal(item.status.phase, "FAILED"); assert.equal(item.journal.status, "FAILED"); const builder = item.journal.executions.find((record) => record.purpose === "BUILDER_IMPLEMENTATION"); assert.equal(builder.status, "ABORTED"); assert.equal(item.state.timings.find((timing) => timing.taskId === builder.taskId).status, "INTERRUPTED"); const workspace = item.state.workspaces.find((candidate) => candidate.taskId === builder.taskId); assert.equal(fs.existsSync(path.join(workspace.root, "docs/learning/offline-fixture-reading.md")), false);
});

test("maximum revision limit stops without integration", () => {
  const item = artifacts("maximumIterations", false); assert.match(evidence().outcomes.maximumIterations, /OFFLINE_AUTOPILOT_NO_PENDING_TASK/u); assert.equal(item.status.phase, "FAILED"); assert.equal(item.state.cycles[0].iteration, 3); assert.equal(item.state.integrationIntents.length, 0); assert.equal(item.state.integrationOutcomes.length, 0);
});

test("execution journal rejects unknown fields, duplicate execution is represented once, and no capability expands", () => {
  const item = artifacts("success"); assert.equal(validateExecutionJournal(item.journal), true); assert.throws(() => validateExecutionJournal({ ...item.journal, unexpected: true }), /EXECUTION_JOURNAL_FIELDS_INVALID/u); assert.equal(new Set(item.journal.executions.map((record) => record.taskDigest)).size, item.journal.executions.length); assert.deepEqual(item.state.capabilities, { realPilotActivation: false, liveProviders: false, network: false, publication: false, scheduling: false }); assert.equal(item.result.providerCalls, 0); assert.equal(item.result.networkCalls, 0); assert.equal(item.result.protectedTargetMutations, 0); assert.equal(item.result.productionIntegrationIntents, 0);
});

test("wrong task digest or role and a conflicting duplicate result are rejected", () => {
  const item = artifacts("success"); const execution = item.journal.executions[0]; const task = item.state.tasks.find((candidate) => candidate.taskId === execution.taskId); const wrongDigest = structuredClone(execution.result); wrongDigest.taskDigest = "0".repeat(64); assert.throws(() => validateRoleResultV2(wrongDigest, task), /task digest mismatch/u); const wrongRole = structuredClone(execution.result); wrongRole.context.role = "builder"; assert.throws(() => validateRoleResultV2(wrongRole, task), /role and purpose do not match|context mismatch/u);
  const copyRoot = uniqueRuntime("duplicate-result"); fs.mkdirSync(copyRoot); const statePath = path.join(copyRoot, "state.json"); fs.copyFileSync(path.join(item.root, "controller-state.json"), statePath); const replay = submitRoleResult({ statePath, ownerId: item.state.owner.id, ownerGeneration: item.state.owner.generation, result: execution.result, now: new Date().toISOString() }); assert.equal(replay.value.status, "IDEMPOTENT_REPLAY"); const conflicting = structuredClone(execution.result); conflicting.payload.rationale = `${conflicting.payload.rationale} altered`; assert.throws(() => submitRoleResult({ statePath, ownerId: item.state.owner.id, ownerGeneration: item.state.owner.generation, result: conflicting, now: new Date().toISOString() }), /CONFLICTING_RESULT/u);
});

test("all V1 runs leave production authority and protected target unchanged", () => {
  const authority = path.join(PRODUCTION_AUTHORITY_ROOT, "authority-state.json"); assert.equal(hash(authority), "9a000d03c6c1ba53b34b6dbb49b66c0d5997d66a60f3385f9fff9ca8c421d8a1"); const before = captureTargetSnapshot(PROTECTED_REAL_TARGET_ROOT); assert.deepEqual(compareTargetSnapshots(before, captureTargetSnapshot(PROTECTED_REAL_TARGET_ROOT)), { equal: true, changed: [] }); const source = ["../src/autopilot.mjs", "../src/role-execution.mjs"].map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8")).join("\n"); assert.doesNotMatch(source, /\bfetch\s*\(|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.search\.brave\.com|api\.resend\.com|git\s+push|wrangler\s+deploy/iu);
});
