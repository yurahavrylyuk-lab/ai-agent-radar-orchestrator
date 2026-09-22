import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { admitRealPilotRequest } from "../src/real-pilot-admission.mjs";
import { commitPilotAuthorization, expectedHumanApprovalStatement, preparePilotAuthorization } from "../src/pilot-authorization.mjs";
import { git } from "../src/git-evidence.mjs";
import { readState } from "../src/local-store.mjs";
import { validatePilotRequest } from "../src/validate.mjs";
import { activationFixture } from "./helpers/activation-fixture.mjs";

function issue(fixture) { const proposal = preparePilotAuthorization({ statePath: fixture.statePath, request: fixture.request, humanApproval: fixture.approval, controllerRoot: fixture.controller.root, now: "2026-09-22T09:00:00.000Z" }); commitPilotAuthorization({ statePath: fixture.statePath, proposal, confirmation: `CONFIRM ${proposal.grant.authorizationDigest}` }); return proposal; }
function admit(fixture) { return admitRealPilotRequest({ statePath: fixture.statePath, request: fixture.request, controllerRoot: fixture.controller.root, now: "2026-09-22T09:01:00.000Z" }); }

test("admission rejects changed controller commit and dirty controller", () => {
  const dirty = activationFixture("admission-dirty-controller"); issue(dirty); fs.writeFileSync(path.join(dirty.controller.root, "untracked"), "dirty\n"); assert.throws(() => admit(dirty), /CONTROLLER_NOT_CLEAN/);
  const changed = activationFixture("admission-changed-controller"); issue(changed); fs.writeFileSync(path.join(changed.controller.root, "README.md"), "changed\n"); git(changed.controller.root, ["add", "README.md"], { write: true }); git(changed.controller.root, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "changed"], { write: true }); git(changed.controller.root, ["update-ref", "refs/remotes/origin/main", "HEAD"], { write: true }); assert.throws(() => admit(changed), /CONTROLLER_COMMIT_MISMATCH/);
});

test("admission rejects wrong branch, dirty target, existing pilot path, unsafe ancestor, and changed snapshot", () => {
  const wrongBranch = activationFixture("admission-wrong-branch"); issue(wrongBranch); git(wrongBranch.target.root, ["checkout", "main"], { write: true }); assert.throws(() => admit(wrongBranch), /TARGET_BRANCH_MISMATCH/);
  const dirty = activationFixture("admission-dirty-target"); issue(dirty); fs.writeFileSync(path.join(dirty.target.root, "dirty.txt"), "dirty\n"); assert.throws(() => admit(dirty), /TARGET_NOT_CLEAN/);
  const existing = activationFixture("admission-existing-path"); issue(existing); const pilot = path.join(existing.target.root, "docs/learning/offline-fixture-reading.md"); fs.mkdirSync(path.dirname(pilot), { recursive: true }); fs.writeFileSync(pilot, "existing\n"); assert.throws(() => admit(existing), /PILOT_PATH_ALREADY_EXISTS/);
  const unsafe = activationFixture("admission-unsafe-ancestor"); issue(unsafe); fs.symlinkSync(".", path.join(unsafe.target.root, "docs")); assert.throws(() => admit(unsafe), /UNSAFE_PILOT_PATH_ANCESTOR/);
  const snapshot = activationFixture("admission-snapshot"); issue(snapshot); git(snapshot.target.root, ["config", "fixture.changed", "true"], { write: true }); assert.throws(() => admit(snapshot), /TARGET_SNAPSHOT_MISMATCH/);
});

test("admission rejects substituted Git-directory identity and invalid evidence mode", () => {
  const substituted = activationFixture("admission-git-identity"); issue(substituted); const original = `${substituted.target.root}-original`; fs.renameSync(substituted.target.root, original); git(substituted.root, ["clone", "--no-local", original, substituted.target.root], { write: true }); assert.throws(() => admit(substituted), /TARGET_GIT_DIRECTORY_IDENTITY_MISMATCH/);
  const mode = activationFixture("admission-mode"); assert.throws(() => validatePilotRequest({ ...mode.request, evidenceMode: "SIMULATED" }), /mode or branch/);
});

test("authorization rejects noncanonical target roots and wrong baselines", () => {
  const alias = activationFixture("authorization-target-alias"); const targetAlias = path.join(alias.root, "target-alias"); fs.symlinkSync(alias.target.root, targetAlias); const aliasRequest = { ...alias.request, targetRoot: targetAlias }; const aliasApproval = { ...alias.approval, statement: expectedHumanApprovalStatement(aliasRequest) }; assert.throws(() => preparePilotAuthorization({ statePath: alias.statePath, request: aliasRequest, humanApproval: aliasApproval, controllerRoot: alias.controller.root, now: "2026-09-22T09:00:00.000Z" }), /TARGET_ROOT_NOT_CANONICAL/);
  const baseline = activationFixture("authorization-wrong-baseline"); const request = { ...baseline.request, baselineCommit: "0".repeat(40) }; const approval = { ...baseline.approval, statement: expectedHumanApprovalStatement(request) }; assert.throws(() => preparePilotAuthorization({ statePath: baseline.statePath, request, humanApproval: approval, controllerRoot: baseline.controller.root, now: "2026-09-22T09:00:00.000Z" }), /TARGET_BASELINE_OR_STATUS_MISMATCH/);
});

test("concurrent admission has one durable claim, one cycle, and one task", async () => {
  const fixture = activationFixture("admission-concurrent"); issue(fixture); const helper = path.resolve("test/helpers/activation-admission-contender.mjs");
  const launch = (at) => new Promise((resolve) => { const child = spawn("/usr/local/bin/node", [helper, fixture.statePath, JSON.stringify(fixture.request), fixture.controller.root, at], { encoding: "utf8" }); let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.on("close", (status) => resolve({ status, stdout, stderr })); });
  const results = await Promise.all([launch("2026-09-22T09:02:00.000Z"), launch("2026-09-22T09:02:01.000Z")]); assert.equal(results.filter((item) => item.status === 0).length >= 1, true); const state = readState(fixture.statePath); assert.equal(state.admissionReceipts.length, 1); assert.equal(state.cycles.length, 1); assert.equal(state.tasks.length, 1); assert.equal(state.authorizations[0].lifecycle.status, "CLAIMED");
});
