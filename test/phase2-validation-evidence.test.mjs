import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { initializeStateV2, readState } from "../src/local-store.mjs";
import { submitRoleResult } from "../src/result-submission.mjs";
import { attestedValidationEntries, checkpointIdentityEvidence, expectedValidationEntries, requiredValidationEvidence } from "../src/validation-evidence.mjs";
import { analystState, makeResult, runtimeDirectory } from "./helpers/phase2-fixture.mjs";

function fixture(commit = "b".repeat(40)) { const root = runtimeDirectory("validation-evidence"); const statePath = path.join(root, "state.json"); const built = analystState(root, { reviewCommit: commit }); initializeStateV2(statePath, built.state); return { statePath, ...built }; }
function result(task, validation, reviewState = "PASS") { return makeResult(task, { reviewedCommit: task.binding.reviewedCommit, reviewState, findings: reviewState === "PASS" ? [] : ["required validation failed"], requiredChanges: reviewState === "REVISE" ? ["correct the candidate"] : [], recommendations: [], validation }); }
function submit(item, roleResult) { return submitRoleResult({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, result: roleResult, now: "2026-09-21T00:01:00.000Z" }); }

test("checkpoint identity evidence never synthesizes a recipe PASS", () => {
  const item = fixture(); const before = fs.readFileSync(item.statePath); const identity = checkpointIdentityEvidence(item.state, item.task); const requirements = requiredValidationEvidence(item.state, item.task); const template = expectedValidationEntries(item.state, item.task);
  assert.equal(identity.evidenceType, "CHECKPOINT_IDENTITY"); assert.equal(identity.provenance, "CONTROLLER_VERIFIED"); assert.ok(requirements.every((entry) => entry.status === "AWAITING_ATTESTATION")); assert.ok(template.every((entry) => entry.outcome === null && entry.evidence === null && entry.evidenceDigest === null));
  const fabricated = requirements.map((entry) => ({ recipeId: entry.recipeId, outcome: "PASS", evidence: entry.identityEvidence, evidenceDigest: entry.identityEvidenceDigest, skipReason: null }));
  assert.throws(() => submit(item, result(item.task, fabricated)), /unknown field|type or provenance|attestation|VALIDATION/u); assert.deepEqual(fs.readFileSync(item.statePath), before);
  const skipped = template.map((entry) => ({ ...entry, outcome: "SKIPPED", skipReason: "Recipe was not performed." })); assert.throws(() => submit(item, result(item.task, skipped)), /REQUIRED_VALIDATION_NOT_PERFORMED/); assert.deepEqual(fs.readFileSync(item.statePath), before);
});

test("required validation rejects empty, missing, duplicate, unknown, and wrong evidence", () => {
  for (const kind of ["empty", "missing", "duplicate", "unknown", "wrong-digest"]) {
    const item = fixture(); const complete = attestedValidationEntries(item.state, item.task, "PASS"); let validation;
    if (kind === "empty") validation = [];
    if (kind === "missing") validation = complete.slice(0, 1);
    if (kind === "duplicate") validation = [complete[0], complete[0]];
    if (kind === "unknown") validation = [complete[0], { ...complete[1], recipeId: "unknown", evidence: { ...complete[1].evidence, recipeId: "unknown" } }];
    if (kind === "wrong-digest") validation = [complete[0], { ...complete[1], evidenceDigest: "f".repeat(64) }];
    assert.throws(() => submit(item, result(item.task, validation)), /validation|VALIDATION|recipe|RECIPE|attestation/u, kind);
  }
});

test("validation evidence is bound to candidate, task, repository, recipe, outcome, and mode", () => {
  const item = fixture("b".repeat(40)); const other = fixture("c".repeat(40)); const wrongCandidate = attestedValidationEntries(other.state, other.task, "PASS");
  assert.throws(() => submit(item, result(item.task, wrongCandidate)), /VALIDATION_EVIDENCE_UNRESOLVABLE/);
  for (const field of ["repositoryId", "taskId", "recipeId", "evidenceMode", "outcome"]) {
    const changed = attestedValidationEntries(item.state, item.task, "PASS"); changed[0].evidence[field] = field === "outcome" ? "FAIL" : `wrong-${field}`;
    assert.throws(() => submit(item, result(item.task, changed)), /invalid|attestation|DIGEST|UNRESOLVABLE/u, field);
  }
});

test("Analyst REVISE persists genuine FAIL attestations, one summary, and Architect revision task", () => {
  const item = fixture(); const failed = attestedValidationEntries(item.state, item.task, "FAIL"); const accepted = submit(item, result(item.task, failed, "REVISE")); const state = readState(item.statePath);
  assert.equal(accepted.value.status, "ACCEPTED"); assert.equal(state.reviews.length, 1); assert.equal(state.reviews[0].reviewState, "REVISE"); assert.equal(state.summaries.filter((summary) => summary.type === "ITERATION").length, 1); assert.equal(state.tasks.find((task) => task.taskId === state.pendingTaskId).purpose, "ARCHITECT_REVISION");
  const retained = state.results.find((record) => record.taskId === item.task.taskId).result.payload.validation; assert.ok(retained.every((entry) => entry.outcome === "FAIL" && entry.evidence.provenance === "HUMAN_ATTESTED" && entry.evidence.evidenceType === "ROLE_VALIDATION_ATTESTATION"));
});

test("Analyst PASS rejects genuine FAIL evidence without persisting progress", () => {
  const item = fixture(); const before = fs.readFileSync(item.statePath); assert.throws(() => submit(item, result(item.task, attestedValidationEntries(item.state, item.task, "FAIL"), "PASS")), /REQUIRED_VALIDATION_DID_NOT_PASS/); assert.deepEqual(fs.readFileSync(item.statePath), before);
});

test("complete human-attested PASS set permits Analyst PASS", () => {
  const item = fixture(); const validation = attestedValidationEntries(item.state, item.task, "PASS"); assert.ok(validation.every((entry) => entry.evidence.outcome === "PASS" && entry.evidence.checkpointIdentityDigest)); const accepted = submit(item, result(item.task, validation)); assert.equal(accepted.value.status, "ACCEPTED");
});
