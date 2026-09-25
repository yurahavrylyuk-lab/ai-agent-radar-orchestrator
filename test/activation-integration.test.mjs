import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { integrateRealCandidate } from "../src/real-local-integration.mjs";
import { mutateStateV2, readState, replaceStateAtomic } from "../src/local-store.mjs";
import { git, resolveCommit } from "../src/git-evidence.mjs";
import { captureTargetSnapshot } from "../src/target-snapshot.mjs";
import { prepareAcceptedActivation } from "./helpers/activation-cycle.mjs";

test("real integration source contains no destructive checkout synchronization command", () => {
  const source = fs.readFileSync(new URL("../src/real-local-integration.mjs", import.meta.url), "utf8");
  for (const command of ["read-tree", "reset", "checkout", "restore", "clean"]) assert.equal(source.includes(`[\"${command}\"`), false, `${command} must not be invoked by real integration`);
});

test("real-local integration advances only the protected ref and records the intentionally preserved checkout", () => {
  const fixture = prepareAcceptedActivation("integration-success"); const baseline = fixture.target.baseline; const beforeTarget = captureTargetSnapshot(fixture.target.root); const result = integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime() });
  assert.equal(result.status, "INTEGRATED"); assert.equal(result.candidateCommit, fixture.candidateCommit); assert.equal(resolveCommit(fixture.target.root), fixture.candidateCommit); assert.equal(resolveCommit(fixture.target.root, "refs/heads/main"), baseline); assert.equal(resolveCommit(fixture.target.root, "refs/remotes/origin/main"), baseline); assert.equal(resolveCommit(fixture.target.root, "refs/remotes/origin/self-improvement"), baseline);
  const afterTarget = captureTargetSnapshot(fixture.target.root); assert.equal(afterTarget.manifestDigest, beforeTarget.manifestDigest); assert.equal(afterTarget.modesDigest, beforeTarget.modesDigest); assert.equal(afterTarget.semanticIndex.digest, beforeTarget.semanticIndex.digest); assert.equal(afterTarget.semanticIndex.equalsHeadTree, false); assert.equal(afterTarget.semanticIndex.cachedDiffEmpty, false); assert.equal(afterTarget.semanticIndex.ordinaryFlagsOnly, true); assert.equal(afterTarget.statusPorcelainV1Base64, Buffer.from("D  docs/learning/offline-fixture-reading.md\0").toString("base64")); assert.equal(fs.existsSync(path.join(fixture.target.root, "docs/learning/offline-fixture-reading.md")), false);
  assert.equal(result.checkoutCondition.status, "REF_ADVANCED_CHECKOUT_PRESERVED"); assert.equal(result.checkoutCondition.synchronizedToNewHead, false); assert.equal(result.checkoutCondition.destructiveCheckoutPerformed, false); assert.equal(result.checkoutCondition.preIntegration.semanticIndex.digest, beforeTarget.semanticIndex.digest); assert.equal(result.checkoutCondition.postIntegration.semanticIndex.digest, beforeTarget.semanticIndex.digest);
  const state = readState(fixture.statePath); assert.equal(state.authorizations[0].lifecycle.status, "CONSUMED"); assert.equal(state.authorizations[0].lifecycle.integratedCommit, fixture.candidateCommit); assert.equal(state.integrationOutcomes.length, 1); assert.equal(state.integrationOutcomes[0].checkoutCondition.status, "REF_ADVANCED_CHECKOUT_PRESERVED"); assert.equal(state.summaries.filter((item) => item.type === "FINAL").length, 1); assert.equal(state.summaries.at(-1).integration.newTip, fixture.candidateCommit); assert.equal(state.summaries.at(-1).protectedTargetComparison.status, "REF_ADVANCED_CHECKOUT_PRESERVED"); assert.equal(state.summaries.at(-1).checkoutCondition.synchronizedToNewHead, false); assert.match(state.summaries.at(-1).limitations.join("\n"), /separate human-controlled action/);
  assert.deepEqual(state.summaries.at(-1).candidateCommits, [fixture.candidateCommit]); assert.equal(state.summaries.at(-1).architectDecisions.at(-1).decision, "ACCEPT"); assert.equal(state.summaries.at(-1).evidenceMode, "HUMAN_ASSISTED"); assert.equal(state.outbox.at(-1).status, "SIMULATED_ACCEPTED");
  const before = fs.readFileSync(fixture.statePath); const replay = integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime() }); assert.equal(replay.status, "IDEMPOTENT_REPLAY"); assert.deepEqual(fs.readFileSync(fixture.statePath), before);
});

test("failure before durable intent leaves authorization claimed and retryable", () => {
  const fixture = prepareAcceptedActivation("integration-before-intent"); assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime(), inject: "before-intent" }), /BEFORE_INTENT/); const state = readState(fixture.statePath); assert.equal(state.authorizations[0].lifecycle.status, "CLAIMED"); assert.equal(state.integrationIntents.length, 0); assert.equal(resolveCommit(fixture.target.root), fixture.target.baseline);
});

for (const phase of ["after-intent", "after-ref", "before-receipt"]) {
  test(`integration uncertainty at ${phase} enters reconciliation and cannot retry`, () => {
    const fixture = prepareAcceptedActivation(`integration-${phase}`); assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime(), inject: phase }), /INTEGRATION_RECONCILIATION_REQUIRED/); const state = readState(fixture.statePath); assert.equal(state.authorizations[0].lifecycle.status, "RECONCILIATION_REQUIRED"); assert.equal(state.integrationIntents[0].status, "RECONCILIATION_REQUIRED"); assert.equal(state.humanHold, true); const targetTip = resolveCommit(fixture.target.root); const bytes = fs.readFileSync(fixture.statePath); assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime() }), /INTEGRATION_RECONCILIATION_REQUIRED/); assert.equal(resolveCommit(fixture.target.root), targetTip); assert.deepEqual(fs.readFileSync(fixture.statePath), bytes);
  });
}

test("late worktree change is preserved and prevents ref advancement", () => {
  const fixture = prepareAcceptedActivation("integration-late-worktree"); const file = path.join(fixture.target.root, "README.md"); const content = "# Late operator worktree change\n";
  assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime(), testBeforeRefRecheck() { fs.writeFileSync(file, content); } }), /INTEGRATION_RECONCILIATION_REQUIRED/);
  assert.equal(fs.readFileSync(file, "utf8"), content); assert.equal(resolveCommit(fixture.target.root), fixture.target.baseline); const state = readState(fixture.statePath); assert.equal(state.authorizations[0].lifecycle.status, "RECONCILIATION_REQUIRED"); assert.equal(state.integrationIntents[0].status, "RECONCILIATION_REQUIRED");
});

test("late staged semantic-index change prevents ref advancement without checkout rewrite", () => {
  const fixture = prepareAcceptedActivation("integration-late-index"); const file = path.join(fixture.target.root, "README.md"); const expected = Buffer.from("# Baseline staged later\n");
  assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime(), testBeforeRefRecheck() { fs.writeFileSync(file, expected); git(fixture.target.root, ["add", "README.md"], { write: true }); } }), (error) => { assert.match(error.message, /INTEGRATION_RECONCILIATION_REQUIRED/); assert.match(error.cause.message, /SEMANTIC_INDEX_HEAD_MISMATCH/); return true; });
  assert.equal(resolveCommit(fixture.target.root), fixture.target.baseline); assert.deepEqual(fs.readFileSync(file), expected); const state = readState(fixture.statePath); assert.notEqual(state.authorizations[0].lifecycle.status, "CONSUMED"); assert.equal(state.integrationOutcomes[0].observedTip, fixture.target.baseline);
});

for (const [name, mutate] of [
  ["mode", ({ targetRoot }) => fs.chmodSync(path.join(targetRoot, "README.md"), 0o755)],
  ["config", ({ targetRoot }) => git(targetRoot, ["config", "gov002.lateDrift", "true"], { write: true })],
]) test(`late ${name} drift prevents ref advancement`, () => {
  const fixture = prepareAcceptedActivation(`integration-late-${name}`); assert.throws(() => integrateRealCandidate({ statePath: fixture.statePath, cycleId: fixture.cycleId, controllerRoot: fixture.controller.root, now: fixture.nextTime(), testBeforeRefRecheck: mutate }), /INTEGRATION_RECONCILIATION_REQUIRED/); assert.equal(resolveCommit(fixture.target.root), fixture.target.baseline); assert.notEqual(readState(fixture.statePath).authorizations[0].lifecycle.status, "CONSUMED");
});

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
