import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { OfflineFixtureTransport } from "../src/adapters/offline-fixture.mjs";
import { MAX_FRAME_BYTES, createExecutionFrame, decodeExecutionFrame, encodeExecutionFrame, validateExecutionFrame } from "../src/role-execution-protocol.mjs";
import { validateExecutionJournal } from "../src/role-execution.mjs";

function load(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function evidence() {
  const file = process.env.GOV002_OFFLINE_AUTOPILOT_EVIDENCE;
  assert.ok(file, "offline autopilot evidence path must be supplied by scripts/test-offline.sh");
  return load(file);
}
function runArtifacts(name) {
  const record = evidence(); const root = record.roots[name];
  return { root, state: load(path.join(root, "controller-state.json")), journal: load(path.join(root, "execution-journal.json")), preparation: load(path.join(root, "integration-preparation.json")), result: load(path.join(root, "result.json")) };
}

test("offline protocol rejects malformed, oversized, stale, cross-task, and digest-invalid frames", () => {
  const taskDigest = "a".repeat(64); const frame = createExecutionFrame({ executionId: "execution:test", taskDigest, sequence: 0, type: "role_result", payload: { ok: true } });
  assert.equal(validateExecutionFrame(frame, { executionId: "execution:test", taskDigest, expectedSequence: 0 }), true);
  assert.throws(() => decodeExecutionFrame(Buffer.from("not-a-frame")), /FRAME_PREFIX_INVALID/u);
  const duplicateJson = '{"protocolVersion":1,"protocolVersion":1}';
  assert.throws(() => decodeExecutionFrame(Buffer.from(`${Buffer.byteLength(duplicateJson)}:${duplicateJson}`)), /FRAME_JSON_INVALID/u);
  assert.throws(() => decodeExecutionFrame(Buffer.from(`${MAX_FRAME_BYTES + 1}:`)), /FRAME_TOO_LARGE/u);
  assert.throws(() => validateExecutionFrame({ ...frame, frameDigest: "0".repeat(64) }), /FRAME_DIGEST_MISMATCH/u);
  assert.throws(() => validateExecutionFrame(frame, { executionId: "execution:wrong" }), /FRAME_EXECUTION_MISMATCH/u);
  assert.throws(() => validateExecutionFrame(frame, { taskDigest: "b".repeat(64) }), /FRAME_TASK_MISMATCH/u);
  assert.throws(() => validateExecutionFrame(frame, { expectedSequence: 1 }), /FRAME_SEQUENCE_MISMATCH/u);
  assert.deepEqual(decodeExecutionFrame(encodeExecutionFrame(frame), { executionId: "execution:test", taskDigest, expectedSequence: 0 }), frame);
});

test("offline fixture transport refuses unsupported scenarios and yields only framed events", () => {
  assert.throws(() => new OfflineFixtureTransport({ scenario: "unknown" }), /OFFLINE_SCENARIO_UNSUPPORTED/u);
  const source = fs.readFileSync(new URL("../src/adapters/offline-fixture.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:fs|child_process|net|http|https)|\bfetch\s*\(/u);
  assert.doesNotMatch(source, /(?:OpenAI|Anthropic|Gemini|Claude|Codex App Server)/iu);
});

test("success scenario performs the exact automatic handoff and stops before integration", () => {
  const { state, journal, preparation, result } = runArtifacts("success");
  assert.equal(result.status, "INTEGRATION_PREPARATION");
  assert.deepEqual(journal.executions.map((item) => item.purpose), ["ARCHITECT_PLAN", "BUILDER_IMPLEMENTATION", "ANALYST_REVIEW", "ARCHITECT_FINAL_DECISION"]);
  assert.ok(journal.executions.every((item) => item.status === "SUBMITTED"));
  assert.equal(state.cycles[0].architectDecision, "ACCEPT");
  assert.equal(preparation.productionIntegrationIntentCreated, false);
  assert.equal(preparation.targetMutationPerformed, false);
  assert.equal(state.integrationIntents.length, 0);
});

test("revision scenario derives REVISE from failed evidence and succeeds on iteration two", () => {
  const { state, journal } = runArtifacts("revision");
  const analysts = journal.executions.filter((item) => item.purpose === "ANALYST_REVIEW");
  assert.equal(analysts.length, 2);
  assert.equal(analysts[0].result.payload.reviewState, "REVISE");
  assert.equal(analysts[0].result.payload.validation.find((item) => item.recipeId === "validate-fictional-offline-content").outcome, "FAIL");
  assert.equal(analysts[1].result.payload.reviewState, "PASS");
  assert.ok(analysts[1].result.payload.validation.every((item) => item.outcome === "PASS"));
  assert.equal(state.cycles[0].iteration, 2);
  assert.equal(state.cycles[0].planRevision, 2);
  assert.equal(state.cycles[0].architectDecision, "ACCEPT");
});

test("Builder execution receipts bind real checkpoint, validations, timing, and submission", () => {
  const { journal } = runArtifacts("success"); const builder = journal.executions.find((item) => item.role === "builder");
  assert.ok(builder.candidateEvidence?.candidateCommit);
  assert.equal(builder.candidateEvidence.candidateCommit, builder.result.payload.candidateCommit);
  assert.match(builder.activeNs, /^[0-9]+$/u);
  assert.ok(BigInt(builder.activeNs) > 0n);
  assert.ok(builder.result.payload.validation.every((item) => item.evidence.provenance === "CONTROLLER_EXECUTED" && item.evidence.executionId === builder.executionId));
  assert.equal(builder.submissionReceipt.resultDigest, builder.resultDigest);
  assert.match(builder.receiptDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(builder.transitions.map((item) => item.status), ["PREPARING", "CONFINEMENT_VERIFIED", "EXECUTING", "RESULT_CAPTURED", "EXECUTION_FINISHED", "SUBMITTED"]);
});

test("execution journal validation rejects unknown fields and status/transition drift", () => {
  const { journal } = runArtifacts("success"); assert.equal(validateExecutionJournal(journal), true);
  assert.throws(() => validateExecutionJournal({ ...journal, unexpected: true }), /EXECUTION_JOURNAL_FIELDS_INVALID/u);
  const drifted = structuredClone(journal); drifted.executions[0].status = "EXECUTING";
  assert.throws(() => validateExecutionJournal(drifted), /EXECUTION_RECORD_INVALID/u);
});

test("real Builder and descendant confinement deny protected roots and network", () => {
  const { journal } = runArtifacts("success"); const builder = journal.executions.find((item) => item.role === "builder");
  const records = builder.confinementEvidence.records;
  for (const context of ["executor", "descendant"]) {
    const map = new Map(records.filter((item) => item.context === context).map((item) => [item.operation, item.observedPermission]));
    assert.equal(map.get("authority-read"), "DENIED"); assert.equal(map.get("authority-write"), "DENIED");
    assert.equal(map.get("controller-write"), "DENIED"); assert.equal(map.get("target-write"), "DENIED");
    assert.equal(map.get("workspace-write"), "ALLOWED"); assert.equal(map.get("network-inbound"), "DENIED"); assert.equal(map.get("network-outbound"), "DENIED");
  }
  assert.equal(builder.confinementEvidence.protectedPathMutationAttempts, 0);
  assert.match(builder.executableIdentity.sha256, /^[0-9a-f]{64}$/u);
});

test("executed validation binds baseline, candidate, tree, blob, recipe, and execution", () => {
  const { journal } = runArtifacts("success"); const builder = journal.executions.find((item) => item.role === "builder");
  for (const entry of builder.result.payload.validation) {
    const item = entry.evidence;
    assert.equal(item.schemaVersion, 3); assert.equal(item.evidenceType, "CONTROLLER_EXECUTED_VALIDATION");
    assert.equal(item.baselineCommit, builder.candidateEvidence.parentCommit); assert.equal(item.candidateCommit, builder.candidateEvidence.candidateCommit);
    assert.equal(item.treeId, builder.candidateEvidence.treeId); assert.equal(item.executionId, builder.executionId);
    assert.match(item.blobDigest, /^[0-9a-f]{64}$/u); assert.match(item.detailsDigest, /^[0-9a-f]{64}$/u);
  }
});

test("restart recovery is safe before execution and between roles", () => {
  const { outcomes } = evidence();
  assert.match(outcomes.crashBefore, /INJECTED_CRASH_BEFORE_EXECUTION/u); assert.equal(outcomes.crashBeforeRecovery, "INTEGRATION_PREPARATION");
  assert.match(outcomes.crashBetween, /INJECTED_CRASH_BETWEEN_ROLES/u); assert.equal(outcomes.crashBetweenRecovery, "INTEGRATION_PREPARATION");
});

test("Builder, captured-result, and uncertain-submission crashes fail closed", () => {
  const { outcomes } = evidence();
  assert.match(outcomes.crashDuring, /INJECTED_CRASH_DURING_BUILDER/u); assert.match(outcomes.crashDuringRecovery, /RECONCILIATION_REQUIRED/u);
  assert.match(outcomes.crashAfterCapture, /INJECTED_CRASH_AFTER_CAPTURE/u); assert.match(outcomes.crashAfterCaptureRecovery, /RECONCILIATION_REQUIRED/u);
  assert.match(outcomes.uncertainSubmission, /PERSISTENCE_DURABILITY_UNCERTAIN/u); assert.match(outcomes.uncertainRecovery, /RECONCILIATION_REQUIRED/u);
});

test("duplicate runner and integration-preparation uncertainty do not advance twice", () => {
  const { outcomes } = evidence();
  assert.match(outcomes.duplicateRunner, /OFFLINE_AUTOPILOT_ALREADY_RUNNING/u);
  assert.match(outcomes.integrationPreparationUncertainty, /INTEGRATION_PREPARATION_UNCERTAIN/u);
});

test("all fixture executions record zero provider, network, publication, and protected-target activity", () => {
  for (const name of ["success", "revision"]) {
    const { result, state } = runArtifacts(name);
    assert.equal(result.providerCalls, 0); assert.equal(result.networkCalls, 0); assert.equal(result.protectedTargetMutations, 0); assert.equal(result.productionIntegrationIntents, 0);
    assert.deepEqual(state.capabilities, { realPilotActivation: false, liveProviders: false, network: false, publication: false, scheduling: false });
  }
  const source = ["../src/autopilot.mjs", "../src/role-execution.mjs", "../src/integration-preparation.mjs"].map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(source, /\bfetch\s*\(|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.search\.brave\.com|api\.resend\.com|git\s+push|wrangler\s+deploy/iu);
});
