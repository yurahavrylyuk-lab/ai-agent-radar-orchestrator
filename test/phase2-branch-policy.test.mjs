import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { enqueueRequest, initializeController, runRehearsal } from "../src/coordinator.mjs";
import { git, resolveCommit, statusPorcelain } from "../src/git-evidence.mjs";
import { integrateFixtureCandidate } from "../src/local-integration.mjs";
import { readState, replaceStateAtomic } from "../src/local-store.mjs";
import { approval, runtimeDirectory } from "./helpers/phase2-fixture.mjs";

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

test("admission rejects main and arbitrary branches without state or Git mutation", () => {
  const root = runtimeDirectory("branch-admission"); const target = path.join(root, "target"); fs.mkdirSync(target); git(target, ["init", "-b", "self-improvement"], { write: true }); fs.writeFileSync(path.join(target, "README.md"), "base\n"); git(target, ["add", "README.md"], { write: true }); git(target, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "base"], { write: true }); const baseline = resolveCommit(target); git(target, ["branch", "main", baseline], { write: true });
  const statePath = path.join(root, "state.json"); initializeController(statePath, { controllerId: "controller", repositoryId: "fixture-repository", evidenceMode: "SIMULATED", ownerId: "owner", targetRoot: target, approval }); const stateBytes = fs.readFileSync(statePath); const indexDigest = sha(fs.readFileSync(path.join(target, ".git", "index"))); const status = statusPorcelain(target);
  for (const targetBranch of ["main", "arbitrary"]) assert.throws(() => enqueueRequest({ statePath, ownerId: "owner", ownerGeneration: 1, request: { schemaVersion: 2, requestId: `request-${targetBranch}`, repositoryId: "fixture-repository", targetRoot: target, targetBranch, baselineCommit: baseline, createdAt: "2026-09-21T00:00:00.000Z" } }), /request is invalid/);
  assert.deepEqual(fs.readFileSync(statePath), stateBytes); assert.equal(resolveCommit(target, "main"), baseline); assert.equal(resolveCommit(target, "self-improvement"), baseline); assert.equal(sha(fs.readFileSync(path.join(target, ".git", "index"))), indexDigest); assert.equal(statusPorcelain(target), status);
});

test("integration component rejects non-pilot branches before intent or Git mutation", async () => {
  const pending = await runRehearsal(runtimeDirectory("branch-integration"), { stopBeforeIntegration: true }); const indexPath = path.join(pending.fixtureRoot, ".git", "index"); const baseline = { main: resolveCommit(pending.fixtureRoot, "main"), pilot: resolveCommit(pending.fixtureRoot, "self-improvement"), head: resolveCommit(pending.fixtureRoot), index: sha(fs.readFileSync(indexPath)), status: statusPorcelain(pending.fixtureRoot), readme: fs.readFileSync(path.join(pending.fixtureRoot, "README.md")) };
  for (const targetBranch of ["main", "arbitrary"]) {
    const state = readState(pending.statePath); state.cycles[0].targetBranch = targetBranch; replaceStateAtomic(pending.statePath, state);
    assert.throws(() => integrateFixtureCandidate({ statePath: pending.statePath, ownerId: pending.ownerId, ownerGeneration: 1, cycleId: pending.cycleId, targetRoot: pending.fixtureRoot, now: "2026-09-21T09:00:00.000Z", fixture: true }), /TARGET_BRANCH_NOT_AUTHORIZED/);
    assert.equal(readState(pending.statePath).integrationIntents.length, 0); assert.equal(resolveCommit(pending.fixtureRoot, "main"), baseline.main); assert.equal(resolveCommit(pending.fixtureRoot, "self-improvement"), baseline.pilot); assert.equal(resolveCommit(pending.fixtureRoot), baseline.head); assert.equal(sha(fs.readFileSync(indexPath)), baseline.index); assert.equal(statusPorcelain(pending.fixtureRoot), baseline.status); assert.deepEqual(fs.readFileSync(path.join(pending.fixtureRoot, "README.md")), baseline.readme);
  }
});
