import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { integrateRealCandidate } from "../src/real-local-integration.mjs";
import { mutateStateV2, readState, replaceStateAtomic } from "../src/local-store.mjs";
import { resolveCommit } from "../src/git-evidence.mjs";
import { captureTargetSnapshot } from "../src/target-snapshot.mjs";
import { prepareAcceptedActivation } from "./helpers/activation-cycle.mjs";

test("real-local integration fixture consumes one permission and preserves candidate and protected ref identities", () => {
  const fixture = prepareAcceptedActivation("integration-success"); const baseline = fixture.target.baseline; const result = integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime() });
  assert.equal(result.status, "INTEGRATED"); assert.equal(result.candidateCommit, fixture.candidateCommit); assert.equal(resolveCommit(fixture.target.root), fixture.candidateCommit); assert.equal(resolveCommit(fixture.target.root, "refs/heads/main"), baseline); assert.equal(resolveCommit(fixture.target.root, "refs/remotes/origin/main"), baseline); assert.equal(resolveCommit(fixture.target.root, "refs/remotes/origin/self-improvement"), baseline);
  const state = readState(fixture.statePath); assert.equal(state.authorizations[0].lifecycle.status, "CONSUMED"); assert.equal(state.authorizations[0].lifecycle.integratedCommit, fixture.candidateCommit); assert.equal(state.integrationOutcomes.length, 1); assert.equal(state.summaries.filter((item) => item.type === "FINAL").length, 1); assert.equal(state.summaries.at(-1).integration.newTip, fixture.candidateCommit);
  assert.deepEqual(state.summaries.at(-1).candidateCommits, [fixture.candidateCommit]); assert.equal(state.summaries.at(-1).architectDecisions.at(-1).decision, "ACCEPT"); assert.equal(state.summaries.at(-1).evidenceMode, "HUMAN_ASSISTED"); assert.equal(state.outbox.at(-1).status, "SIMULATED_ACCEPTED");
  const before = fs.readFileSync(fixture.statePath); const replay = integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime() }); assert.equal(replay.status, "IDEMPOTENT_REPLAY"); assert.deepEqual(fs.readFileSync(fixture.statePath), before);
});

test("failure before durable intent leaves authorization claimed and retryable", () => {
  const fixture = prepareAcceptedActivation("integration-before-intent"); assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime(), inject: "before-intent" }), /BEFORE_INTENT/); const state = readState(fixture.statePath); assert.equal(state.authorizations[0].lifecycle.status, "CLAIMED"); assert.equal(state.integrationIntents.length, 0); assert.equal(resolveCommit(fixture.target.root), fixture.target.baseline);
});

for (const phase of ["after-intent", "after-ref", "after-worktree", "before-receipt"]) {
  test(`integration uncertainty at ${phase} enters reconciliation and cannot retry`, () => {
    const fixture = prepareAcceptedActivation(`integration-${phase}`); assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime(), inject: phase }), /INTEGRATION_RECONCILIATION_REQUIRED/); const state = readState(fixture.statePath); assert.equal(state.authorizations[0].lifecycle.status, "RECONCILIATION_REQUIRED"); assert.equal(state.integrationIntents[0].status, "RECONCILIATION_REQUIRED"); assert.equal(state.humanHold, true); const targetTip = resolveCommit(fixture.target.root); const bytes = fs.readFileSync(fixture.statePath); assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime() }), /INTEGRATION_RECONCILIATION_REQUIRED/); assert.equal(resolveCommit(fixture.target.root), targetTip); assert.deepEqual(fs.readFileSync(fixture.statePath), bytes);
  });
}

function mutateFixture(fixture, mutator) {
  mutateStateV2({ statePath: fixture.statePath, ownerId: fixture.ownerId, ownerGeneration: fixture.ownerGeneration, mutator(state) { mutator(state); state.stateVersion += 1; return { state }; } });
}

function assertIntegrationUntouched(fixture, beforeTarget) {
  const state = readState(fixture.statePath); assert.equal(state.authorizations[0].lifecycle.status, "CLAIMED"); assert.equal(state.integrationIntents.length, 0); assert.equal(state.summaries.filter((item) => item.type === "FINAL").length, 0); assert.equal(resolveCommit(fixture.target.root), fixture.target.baseline);
  const afterTarget = captureTargetSnapshot(fixture.target.root); assert.equal(afterTarget.manifestDigest, beforeTarget.manifestDigest); assert.equal(afterTarget.semanticIndex.digest, beforeTarget.semanticIndex.digest); assert.equal(afterTarget.statusDigest, beforeTarget.statusDigest);
}

test("human hold rejects an otherwise eligible integration before intent or target mutation", () => {
  const fixture = prepareAcceptedActivation("integration-human-hold"); const beforeTarget = captureTargetSnapshot(fixture.target.root); mutateFixture(fixture, (state) => { state.humanHold = true; });
  assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime() }), /HUMAN_HOLD_ACTIVE/); assertIntegrationUntouched(fixture, beforeTarget); assert.equal(readState(fixture.statePath).humanHold, true);
});

test("hold appearing between precheck and locked transition is refused without an intent", () => {
  const fixture = prepareAcceptedActivation("integration-raced-hold"); const beforeTarget = captureTargetSnapshot(fixture.target.root);
  assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime(), testBeforeLockedRecheck() { mutateFixture(fixture, (state) => { state.humanHold = true; }); } }), /HUMAN_HOLD_ACTIVE/); assertIntegrationUntouched(fixture, beforeTarget);
});

for (const [name, mutate, error] of [
  ["cycle stage", (state) => { state.cycles[0].stage = "ARCHITECT_FINAL_DECISION"; }, /CYCLE_NOT_INTEGRATION_READY/],
  ["candidate", (state) => { state.cycles[0].candidateCommit = "0".repeat(40); }, /INDEPENDENT_ANALYST_PASS_REQUIRED|INTEGRATION_ELIGIBILITY_CHANGED/],
  ["Analyst review", (state) => { state.cycles[0].analystResultDigest = "0".repeat(64); }, /INDEPENDENT_ANALYST_PASS_REQUIRED|INTEGRATION_ELIGIBILITY_CHANGED/],
  ["Architect ACCEPT", (state) => { state.cycles[0].architectResultDigest = "0".repeat(64); }, /INTEGRATION_ELIGIBILITY_CHANGED/],
]) {
  test(`locked recheck refuses stale ${name} without intent or target mutation`, () => {
    const fixture = prepareAcceptedActivation(`integration-stale-${name.replaceAll(" ", "-")}`); const beforeTarget = captureTargetSnapshot(fixture.target.root);
    assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime(), testBeforeLockedRecheck() { mutateFixture(fixture, mutate); } }), error); assertIntegrationUntouched(fixture, beforeTarget);
  });
}

test("locked validation rejects stale successful validation evidence without intent or target mutation", () => {
  const fixture = prepareAcceptedActivation("integration-stale-validation"); const beforeTarget = captureTargetSnapshot(fixture.target.root);
  assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime(), testBeforeLockedRecheck() { const state = readState(fixture.statePath); const analyst = state.results.find((item) => item.role === "analyst"); analyst.result.payload.validation[0].outcome = "FAIL"; replaceStateAtomic(fixture.statePath, state); } }), /digest mismatch|validation/i); assertIntegrationUntouched(fixture, beforeTarget);
});

test("unresolved checkpoint reconciliation rejects integration before intent", () => {
  const fixture = prepareAcceptedActivation("integration-checkpoint-hold"); const beforeTarget = captureTargetSnapshot(fixture.target.root); mutateFixture(fixture, (state) => { const intent = state.checkpointIntents.at(-1); intent.status = "RECONCILIATION_REQUIRED"; delete intent.candidateCommit; delete intent.digest; });
  assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime() }), /CHECKPOINT_RECONCILIATION_ACTIVE/); assertIntegrationUntouched(fixture, beforeTarget);
});
