import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { integrateRealCandidate } from "../src/real-local-integration.mjs";
import { readState } from "../src/local-store.mjs";
import { resolveCommit } from "../src/git-evidence.mjs";
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
