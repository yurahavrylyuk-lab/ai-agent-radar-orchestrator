import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { enqueueRequest, initializeController, registerWorkspace, runRehearsal } from "../src/coordinator.mjs";
import { git, remotes, resolveCommit, validatePilotContent, verifyPilotCandidate } from "../src/git-evidence.mjs";
import { integrateFixtureCandidate } from "../src/local-integration.mjs";
import { createLocalCheckpoint } from "../src/local-checkpoint.mjs";
import { readState } from "../src/local-store.mjs";
import { finishRole, startRole } from "../src/role-timing.mjs";
import { submitRoleResult } from "../src/result-submission.mjs";
import { createIndependentWorkspace, resolveRegisteredWorkspace } from "../src/workspaces.mjs";
import { approval, makeResult, OID_A, runtimeDirectory } from "./helpers/phase2-fixture.mjs";

test("actual CLI-equivalent rehearsal completes REVISE then PASS then ACCEPT and preserves commit identity", async () => {
  const result = await runRehearsal(runtimeDirectory("rehearsal")); const state = readState(result.statePath);
  assert.equal(result.cycleId, "cycle:rehearsal-request"); assert.equal(result.candidateCommits.length, 2); assert.equal(result.reviewSummaryIds.length, 2); assert.equal(result.integratedCommit, result.candidateCommits[1]);
  assert.equal(state.summaries.filter((item) => item.type === "ITERATION").length, 2); assert.equal(state.summaries.filter((item) => item.type === "FINAL").length, 1); assert.equal(state.cycles[0].status, "ACCEPTED"); assert.equal(state.evidenceMode, "SIMULATED");
  assert.equal(resolveCommit(result.fixtureRoot, "refs/heads/main"), result.baseline); assert.equal(resolveCommit(result.fixtureRoot, "refs/heads/self-improvement"), result.candidateCommits[1]); assert.deepEqual(remotes(result.fixtureRoot), []);
});
test("rehearsal commit identities are deterministic across disposable repositories", async () => {
  const left = await runRehearsal(runtimeDirectory("rehearsal-deterministic-a")); const right = await runRehearsal(runtimeDirectory("rehearsal-deterministic-b")); assert.equal(left.baseline, right.baseline); assert.deepEqual(left.candidateCommits, right.candidateCommits); assert.equal(left.finalSummaryDigest, right.finalSummaryDigest);
});
test("integration writes an intent first, interruption creates reconciliation hold, and no retry is allowed", async () => {
  const pending = await runRehearsal(runtimeDirectory("integration-uncertain"), { stopBeforeIntegration: true });
  assert.throws(() => integrateFixtureCandidate({ statePath: pending.statePath, ownerId: pending.ownerId, ownerGeneration: 1, cycleId: pending.cycleId, targetRoot: pending.fixtureRoot, now: "2026-09-21T09:00:00.000Z", fixture: true, inject: "after-ref" }), /INTEGRATION_RECONCILIATION_REQUIRED/);
  const state = readState(pending.statePath); assert.equal(state.humanHold, true); assert.equal(state.integrationIntents[0].status, "RECONCILIATION_REQUIRED"); assert.equal(state.integrationOutcomes[0].status, "INTEGRATION_RECONCILIATION_REQUIRED");
  assert.throws(() => integrateFixtureCandidate({ statePath: pending.statePath, ownerId: pending.ownerId, ownerGeneration: 1, cycleId: pending.cycleId, targetRoot: pending.fixtureRoot, now: "2026-09-21T09:01:00.000Z", fixture: true }), /INTEGRATION_RECONCILIATION_REQUIRED/);
});
test("integration rejects a substituted target identity before writing an intent", async () => {
  const pending = await runRehearsal(runtimeDirectory("integration-substitution"), { stopBeforeIntegration: true }); const substitute = runtimeDirectory("substitute-target"); const before = fs.readFileSync(pending.statePath);
  assert.throws(() => integrateFixtureCandidate({ statePath: pending.statePath, ownerId: pending.ownerId, ownerGeneration: 1, cycleId: pending.cycleId, targetRoot: substitute, now: "2026-09-21T09:00:00.000Z", fixture: true }), /TARGET_IDENTITY_MISMATCH/); assert.deepEqual(fs.readFileSync(pending.statePath), before);
});
test("checkpoint interruption after commit creates a durable reconciliation hold and prohibits retry", () => {
  const root = runtimeDirectory("checkpoint-uncertain"); const target = path.join(root, "target"); const workspaceRuntime = path.join(root, "runtime"); fs.mkdirSync(target); fs.mkdirSync(workspaceRuntime);
  git(target, ["init", "-b", "self-improvement"], { write: true }); fs.writeFileSync(path.join(target, "README.md"), "base\n"); git(target, ["add", "README.md"], { write: true }); git(target, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "base"], { write: true }); git(target, ["branch", "main"], { write: true }); const baseline = resolveCommit(target);
  const statePath = path.join(root, "state.json"); initializeController(statePath, { controllerId: "controller", repositoryId: "fixture-repository", evidenceMode: "SIMULATED", ownerId: "owner", targetRoot: target, approval }); enqueueRequest({ statePath, ownerId: "owner", ownerGeneration: 1, request: { schemaVersion: 2, requestId: "request", repositoryId: "fixture-repository", targetRoot: target, targetBranch: "self-improvement", baselineCommit: baseline, createdAt: "2026-09-21T00:00:00.000Z" } });
  let state = readState(statePath); let task = state.tasks.at(-1); const payload = { goal: "guide", scope: approval.scope, allowedChanges: approval.allowedChanges, forbiddenChanges: approval.forbiddenChanges, acceptanceCriteria: approval.acceptanceCriteria, validationRequirements: approval.validationRequirements, risks: [], rationale: "bounded", resolvesFindingIds: [] }; startRole({ statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:00:00.100Z" }); finishRole({ statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:00:00.200Z" }); submitRoleResult({ statePath, ownerId: "owner", ownerGeneration: 1, result: makeResult(task, payload), now: "2026-09-21T00:00:01.000Z" });
  state = readState(statePath); task = state.tasks.at(-1); const workspace = createIndependentWorkspace({ sourceRoot: target, runtimeRoot: workspaceRuntime, workspaceId: task.binding.workspaceId, commit: baseline, role: "builder" }); registerWorkspace({ statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, workspace }); const file = path.join(workspace.root, "docs/learning/offline-fixture-reading.md"); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "fictional offline guide\n");
  assert.throws(() => createLocalCheckpoint({ statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:00:02.000Z", inject: "after-commit" }), /CHECKPOINT_RECONCILIATION_REQUIRED/); state = readState(statePath); assert.equal(state.humanHold, true); assert.equal(state.checkpointIntents[0].status, "RECONCILIATION_REQUIRED"); assert.equal(state.checkpointReceipts.length, 0); assert.notEqual(resolveCommit(workspace.root), baseline);
  assert.throws(() => createLocalCheckpoint({ statePath, ownerId: "owner", ownerGeneration: 1, taskId: task.taskId, now: "2026-09-21T00:00:03.000Z" }), /CHECKPOINT_RECONCILIATION_REQUIRED/);
});
test("real target activation gate refuses before any target operation", async () => {
  const pending = await runRehearsal(runtimeDirectory("real-gate"), { stopBeforeIntegration: true }); const before = fs.readFileSync(pending.statePath);
  assert.throws(() => integrateFixtureCandidate({ statePath: pending.statePath, ownerId: pending.ownerId, ownerGeneration: 1, cycleId: pending.cycleId, targetRoot: "/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent", now: "2026-09-21T09:00:00.000Z", fixture: true }), /REAL_PILOT_NOT_AUTHORIZED/); assert.deepEqual(fs.readFileSync(pending.statePath), before);
});
test("workspace registry rejects substituted roots", () => {
  const root = runtimeDirectory("workspace-substitution"); const noncanonical = `${root}/../${path.basename(root)}`; assert.throws(() => resolveRegisteredWorkspace({ root: noncanonical, role: "builder" }, "builder"), /SUBSTITUTED/);
});
test("Git verifier rejects dirty, symlink, executable, merge, and out-of-scope candidates", () => {
  const make = (kind) => { const root = runtimeDirectory(`git-${kind}`); git(root, ["init", "-b", "main"], { write: true }); fs.writeFileSync(path.join(root, "README.md"), "base\n"); git(root, ["add", "README.md"], { write: true }); git(root, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "base"], { write: true, env: { GIT_AUTHOR_DATE: "2026-09-21T00:00:00Z", GIT_COMMITTER_DATE: "2026-09-21T00:00:00Z" } }); const baseline = resolveCommit(root); const file = path.join(root, "docs/learning/offline-fixture-reading.md"); fs.mkdirSync(path.dirname(file), { recursive: true }); if (kind === "symlink") fs.symlinkSync("README.md", file); else fs.writeFileSync(file, "guide\n"); if (kind === "executable") fs.chmodSync(file, 0o755); if (kind === "scope") fs.writeFileSync(path.join(root, "extra.txt"), "extra\n"); git(root, ["add", "-A"], { write: true }); git(root, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", kind], { write: true, env: { GIT_AUTHOR_DATE: "2026-09-21T00:01:00Z", GIT_COMMITTER_DATE: "2026-09-21T00:01:00Z" } }); return { root, baseline, candidate: resolveCommit(root) }; };
  for (const kind of ["symlink", "executable", "scope"]) { const item = make(kind); assert.throws(() => verifyPilotCandidate({ root: item.root, candidateCommit: item.candidate, expectedParent: item.baseline, baselineCommit: item.baseline }), /VIOLATION/); }
  const dirty = make("valid"); fs.writeFileSync(path.join(dirty.root, "dirty.txt"), "dirty\n"); assert.throws(() => verifyPilotCandidate({ root: dirty.root, candidateCommit: dirty.candidate, expectedParent: dirty.baseline, baselineCommit: dirty.baseline }), /NOT_CLEAN/);
  const mergeRoot = runtimeDirectory("git-merge"); git(mergeRoot, ["init", "-b", "main"], { write: true }); fs.writeFileSync(path.join(mergeRoot, "README.md"), "base\n"); git(mergeRoot, ["add", "README.md"], { write: true }); git(mergeRoot, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "base"], { write: true }); const mergeBaseline = resolveCommit(mergeRoot); git(mergeRoot, ["branch", "side"], { write: true }); const mergeFile = path.join(mergeRoot, "docs/learning/offline-fixture-reading.md"); fs.mkdirSync(path.dirname(mergeFile), { recursive: true }); fs.writeFileSync(mergeFile, "fictional offline guide\n"); git(mergeRoot, ["add", "-A"], { write: true }); git(mergeRoot, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "pilot"], { write: true }); const firstParent = resolveCommit(mergeRoot); git(mergeRoot, ["checkout", "side"], { write: true }); fs.writeFileSync(path.join(mergeRoot, "side.txt"), "side\n"); git(mergeRoot, ["add", "side.txt"], { write: true }); git(mergeRoot, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "side"], { write: true }); git(mergeRoot, ["checkout", "main"], { write: true }); git(mergeRoot, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "merge", "--no-ff", "side", "-m", "merge"], { write: true }); assert.throws(() => verifyPilotCandidate({ root: mergeRoot, candidateCommit: resolveCommit(mergeRoot), expectedParent: firstParent, baselineCommit: mergeBaseline }), /NONLINEAR/);
  assert.notEqual(OID_A, dirty.baseline);
});
test("future pilot content enforces the 800-word offline guide boundary without claiming semantic review", () => {
  assert.deepEqual(validatePilotContent("A clearly fictional offline fixture guide."), { wordCount: 6, automatedConstraintsOnly: true });
  assert.throws(() => validatePilotContent(`fictional offline ${"word ".repeat(799)}`), /WORD_LIMIT/);
  assert.throws(() => validatePilotContent("fictional offline wrangler deploy instructions"), /PROHIBITED_CONTENT/);
  assert.throws(() => validatePilotContent("ordinary guide"), /OFFLINE_LABEL/);
});
