import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { sha256Canonical } from "../src/contracts.mjs";
import { readState, replaceStateAtomic } from "../src/local-store.mjs";
import { authorityStoreIdentity, PROTECTED_REAL_TARGET_ROOT } from "../src/operator-boundary.mjs";
import { commitPilotAuthorization, preparePilotAuthorization } from "../src/pilot-authorization.mjs";
import { admitRealPilotRequest } from "../src/real-pilot-admission.mjs";
import { captureTargetSnapshot } from "../src/target-snapshot.mjs";
import { validateAuthorityState } from "../src/validate.mjs";
import { prepareAcceptedActivation } from "./helpers/activation-cycle.mjs";
import { activationFixture } from "./helpers/activation-fixture.mjs";

function issue(fixture) {
  const proposal = preparePilotAuthorization({ statePath: fixture.statePath, request: fixture.request, humanApproval: fixture.approval, controllerRoot: fixture.controller.root, now: "2026-09-24T09:00:00.000Z" });
  commitPilotAuthorization({ statePath: fixture.statePath, proposal, confirmation: `CONFIRM ${proposal.grant.authorizationDigest}` });
  return proposal;
}

function realRequest(request, suffix) {
  return { ...request, requestId: `${request.requestId}-${suffix}`, targetRoot: PROTECTED_REAL_TARGET_ROOT, baselineCommit: "33a60a1f74960f9c171f5449627db1be362c6481" };
}

test("fabricated ledger payload cannot redefine a disposable store as production authority", () => {
  const fixture = activationFixture("fabricated-authority"); issue(fixture);
  const state = readState(fixture.statePath);
  state.authorityStore.canonicalRoot = "/Users/yuriy/Library/Application Support/AI Agent Radar Orchestrator/authority";
  replaceStateAtomic(fixture.statePath, state);
  assert.throws(() => admitRealPilotRequest({ statePath: fixture.statePath, request: realRequest(fixture.request, "real"), controllerRoot: fixture.controller.root }), /REAL_AUTHORITY_STORE_LOCATION_REQUIRED/);
  assert.equal(readState(fixture.statePath).cycles.length, 0);
});

test("copied and rebound internally consistent ledger cannot authorize the protected real target", () => {
  const fixture = activationFixture("rebound-authority"); issue(fixture);
  const reboundRoot = path.join(fixture.root, "rebound-authority"); fs.mkdirSync(reboundRoot, { mode: 0o700 }); const reboundPath = path.join(reboundRoot, "authority-state.json");
  const state = readState(fixture.statePath); const identity = authorityStoreIdentity(reboundPath);
  state.authorityStore = { ...state.authorityStore, ...identity };
  for (const record of state.authorizations) {
    record.grant.authorityStoreId = identity.authorityStoreId;
    const unsigned = structuredClone(record.grant); delete unsigned.authorizationDigest; record.grant.authorizationDigest = sha256Canonical(unsigned);
    record.lifecycle.authorizationDigest = record.grant.authorizationDigest;
  }
  replaceStateAtomic(reboundPath, state); assert.equal(validateAuthorityState(readState(reboundPath), reboundPath), true);
  assert.throws(() => admitRealPilotRequest({ statePath: reboundPath, request: realRequest(fixture.request, "rebound-real"), controllerRoot: fixture.controller.root }), /REAL_AUTHORITY_STORE_LOCATION_REQUIRED/);
  assert.equal(readState(reboundPath).cycles.length, 0);
});

test("public integrate-local rejects fabricated disposable authority for the protected target before intent or target mutation", () => {
  const fixture = prepareAcceptedActivation("fabricated-integrate"); const state = readState(fixture.statePath); const beforeState = fs.readFileSync(fixture.statePath); const beforeTarget = captureTargetSnapshot(PROTECTED_REAL_TARGET_ROOT);
  state.cycles[0].targetRoot = PROTECTED_REAL_TARGET_ROOT; state.authorizations[0].grant.canonicalTargetRoot = PROTECTED_REAL_TARGET_ROOT; replaceStateAtomic(fixture.statePath, state);
  const fabricatedBytes = fs.readFileSync(fixture.statePath);
  const result = spawnSync("/usr/local/bin/node", [path.resolve("src/cli.mjs"), "integrate-local", "--state", fixture.statePath, "--cycle", fixture.cycleId], { cwd: fixture.controller.root, encoding: "utf8", env: { ...process.env, GOV002_TEST_DISPOSABLE_AUTHORITY: "1" } });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /REAL_AUTHORITY_STORE_LOCATION_REQUIRED/); assert.deepEqual(fs.readFileSync(fixture.statePath), fabricatedBytes); assert.equal(readState(fixture.statePath).integrationIntents.length, 0);
  const afterTarget = captureTargetSnapshot(PROTECTED_REAL_TARGET_ROOT); assert.equal(afterTarget.head, beforeTarget.head); assert.equal(afterTarget.statusDigest, beforeTarget.statusDigest); assert.equal(afterTarget.manifestDigest, beforeTarget.manifestDigest); assert.equal(afterTarget.semanticIndex.digest, beforeTarget.semanticIndex.digest); assert.notDeepEqual(fabricatedBytes, beforeState);
});
