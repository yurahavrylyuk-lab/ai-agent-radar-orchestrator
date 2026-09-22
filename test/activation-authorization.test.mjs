import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { verifyControllerRemotePolicy } from "../src/controller-remote-policy.mjs";
import { admitRealPilotRequest } from "../src/real-pilot-admission.mjs";
import { commitPilotAuthorization, expectedHumanApprovalStatement, preparePilotAuthorization, showPilotAuthorization } from "../src/pilot-authorization.mjs";
import { readState } from "../src/local-store.mjs";
import { validateAuthorityState, validatePilotAuthorizationGrant, validatePilotRequest } from "../src/validate.mjs";
import { git } from "../src/git-evidence.mjs";
import { activationFixture } from "./helpers/activation-fixture.mjs";

const issuedAt = "2026-09-22T06:03:00.000Z";
function issue(fixture) {
  const proposal = preparePilotAuthorization({ statePath: fixture.statePath, request: fixture.request, humanApproval: fixture.approval, controllerRoot: fixture.controller.root, now: issuedAt });
  const receipt = commitPilotAuthorization({ statePath: fixture.statePath, proposal, confirmation: `CONFIRM ${proposal.grant.authorizationDigest}` });
  return { proposal, receipt };
}

test("activation authorization is digest-bound, human-confirmed, and stored in an exact protected ledger", () => {
  const fixture = activationFixture("authorization-valid"); const { proposal, receipt } = issue(fixture); const state = readState(fixture.statePath);
  assert.equal(validatePilotRequest(fixture.request), true); assert.equal(validatePilotAuthorizationGrant(proposal.grant), true); assert.equal(validateAuthorityState(state, fixture.statePath), true);
  assert.equal(receipt.status, "ISSUED"); assert.equal(state.authorizations[0].lifecycle.status, "ISSUED"); assert.equal(state.capabilities.realPilotActivation, true); assert.equal(state.capabilities.network, false); assert.equal(state.capabilities.publication, false);
  assert.equal(showPilotAuthorization(fixture.statePath, proposal.grant.authorizationId).grant.authorizationDigest, proposal.grant.authorizationDigest);
});

test("one bound authority ledger retains prior authorization history when a later grant is issued", () => {
  const fixture = activationFixture("authorization-ledger"); const first = issue(fixture); const secondRequest = { ...fixture.request, requestId: "authorization-ledger-second-request", createdAt: "2026-09-22T06:04:00.000Z" }; const secondApproval = { source: "HUMAN_OPERATOR", reference: "authorization-ledger-second-human", statement: expectedHumanApprovalStatement(secondRequest) };
  const second = preparePilotAuthorization({ statePath: fixture.statePath, request: secondRequest, humanApproval: secondApproval, controllerRoot: fixture.controller.root, now: "2026-09-22T06:05:00.000Z" }); commitPilotAuthorization({ statePath: fixture.statePath, proposal: second, confirmation: `CONFIRM ${second.grant.authorizationDigest}` });
  const state = readState(fixture.statePath); assert.equal(state.authorizations.length, 2); assert.equal(state.authorizations[0].grant.authorizationDigest, first.proposal.grant.authorizationDigest); assert.equal(state.authorizations[0].lifecycle.status, "ISSUED"); assert.equal(state.authorizations[1].grant.authorizationDigest, second.grant.authorizationDigest); assert.equal(state.authorizations[1].lifecycle.status, "ISSUED"); assert.equal(state.authorityStore.authorityStoreId, first.proposal.store.authorityStoreId);
});

test("missing, role-forged, altered, and copied authorization cannot create authority", () => {
  const missing = activationFixture("authorization-missing"); assert.throws(() => admitRealPilotRequest({ statePath: missing.statePath, request: missing.request, controllerRoot: missing.controller.root, now: issuedAt }), /ENOENT/);
  const forged = activationFixture("authorization-forged"); const proposal = preparePilotAuthorization({ statePath: forged.statePath, request: forged.request, humanApproval: forged.approval, controllerRoot: forged.controller.root, now: issuedAt });
  assert.throws(() => commitPilotAuthorization({ statePath: forged.statePath, proposal, confirmation: "CONFIRM role-result-selected-value" }), /DIGEST_SPECIFIC/); assert.equal(fs.existsSync(forged.statePath), false);
  const altered = structuredClone(proposal.grant); altered.contentRestrictions.maxWords = 801; assert.throws(() => validatePilotAuthorizationGrant(altered), /word limit|digest mismatch/);
  commitPilotAuthorization({ statePath: forged.statePath, proposal, confirmation: `CONFIRM ${proposal.grant.authorizationDigest}` }); const copyRoot = path.join(forged.root, "copied-authority"); fs.mkdirSync(copyRoot, { mode: 0o700 }); const copied = path.join(copyRoot, "authority-state.json"); fs.copyFileSync(forged.statePath, copied); assert.throws(() => showPilotAuthorization(copied, proposal.grant.authorizationId), /canonical state path|BINDING/);
  const original = `${forged.statePath}.regular`; fs.renameSync(forged.statePath, original); fs.symlinkSync(original, forged.statePath); assert.throws(() => showPilotAuthorization(forged.statePath, proposal.grant.authorizationId), /AUTHORITY_STATE_FILE_UNSAFE/);
});

test("controller remote policy rejects wrong fetch, push, rewrite, and second remotes", () => {
  for (const kind of ["fetch", "push", "rewrite", "second"]) {
    const fixture = activationFixture(`remote-${kind}`); const root = fixture.controller.root;
    if (kind === "fetch") git(root, ["remote", "set-url", "origin", "https://github.com/example/wrong.git"], { write: true });
    if (kind === "push") git(root, ["remote", "set-url", "--push", "origin", "https://github.com/example/wrong.git"], { write: true });
    if (kind === "rewrite") git(root, ["config", "url.https://github.com/example/.insteadOf", "https://github.com/yurahavrylyuk-lab/"], { write: true });
    if (kind === "second") git(root, ["remote", "add", "unexpected", "https://github.com/example/unexpected.git"], { write: true });
    assert.throws(() => verifyControllerRemotePolicy(root), /REMOTE/);
  }
});

test("admission atomically claims exactly once and identical restart replay returns the same cycle and task", () => {
  const fixture = activationFixture("admission-once"); const { proposal } = issue(fixture);
  const first = admitRealPilotRequest({ statePath: fixture.statePath, request: fixture.request, controllerRoot: fixture.controller.root, now: "2026-09-22T06:04:00.000Z" }); assert.equal(first.status, "ADMITTED");
  const bytes = fs.readFileSync(fixture.statePath); const replay = admitRealPilotRequest({ statePath: fixture.statePath, request: fixture.request, controllerRoot: fixture.controller.root, now: "2026-09-22T06:05:00.000Z" }); assert.equal(replay.status, "IDEMPOTENT_REPLAY"); assert.deepEqual(fs.readFileSync(fixture.statePath), bytes);
  const state = readState(fixture.statePath); assert.equal(state.authorizations[0].lifecycle.status, "CLAIMED"); assert.equal(state.authorizations[0].grant.authorizationId, proposal.grant.authorizationId); assert.equal(state.admissionReceipts.length, 1); assert.equal(state.cycles.length, 1); assert.equal(state.tasks.length, 1);
  const changed = { ...fixture.request, requestId: "changed-request" }; assert.throws(() => admitRealPilotRequest({ statePath: fixture.statePath, request: changed, controllerRoot: fixture.controller.root, now: "2026-09-22T06:06:00.000Z" }), /MATCHING_AUTHORIZATION|MISMATCH/);
});
