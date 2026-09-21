import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { initializeStateV2 } from "../src/local-store.mjs";
import { submitRoleResult } from "../src/result-submission.mjs";
import { expectedValidationEntries } from "../src/validation-evidence.mjs";
import { analystState, makeResult, runtimeDirectory } from "./helpers/phase2-fixture.mjs";

function fixture(commit = "b".repeat(40)) { const root = runtimeDirectory("validation-evidence"); const statePath = path.join(root, "state.json"); const built = analystState(root, { reviewCommit: commit }); initializeStateV2(statePath, built.state); return { statePath, ...built }; }
function result(state, task, validation) { return makeResult(task, { reviewedCommit: task.binding.reviewedCommit, reviewState: "PASS", findings: [], requiredChanges: [], recommendations: [], validation }); }
function submit(item, roleResult) { return submitRoleResult({ statePath: item.statePath, ownerId: "owner", ownerGeneration: 1, result: roleResult, now: "2026-09-21T00:01:00.000Z" }); }

test("required validation rejects empty, missing, duplicate, unknown, and wrong evidence", () => {
  for (const kind of ["empty", "missing", "duplicate", "unknown", "wrong-digest"]) {
    const item = fixture(); const complete = expectedValidationEntries(item.state, item.task); let validation;
    if (kind === "empty") validation = [];
    if (kind === "missing") validation = complete.slice(0, 1);
    if (kind === "duplicate") validation = [complete[0], complete[0]];
    if (kind === "unknown") validation = [complete[0], { ...complete[1], recipeId: "unknown" }];
    if (kind === "wrong-digest") validation = [complete[0], { ...complete[1], evidenceDigest: "f".repeat(64) }];
    assert.throws(() => submit(item, result(item.state, item.task, validation)), /validation|VALIDATION|recipe|RECIPE/u, kind);
  }
});

test("validation evidence is bound to candidate, task, repository, and recipe", () => {
  const item = fixture("b".repeat(40)); const other = fixture("c".repeat(40));
  assert.throws(() => submit(item, result(item.state, item.task, expectedValidationEntries(other.state, other.task))), /VALIDATION_EVIDENCE_UNRESOLVABLE/);
});

test("complete checkpoint-backed validation set permits Analyst PASS", () => {
  const item = fixture(); const accepted = submit(item, result(item.state, item.task, expectedValidationEntries(item.state, item.task))); assert.equal(accepted.value.status, "ACCEPTED");
});
