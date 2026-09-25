import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APPROVED_CONTROLLER_ORIGIN } from "../../src/controller-remote-policy.mjs";
import { expectedHumanApprovalStatement } from "../../src/pilot-authorization.mjs";
import { git, resolveCommit } from "../../src/git-evidence.mjs";

process.env.GOV002_TEST_DISPOSABLE_AUTHORITY = "1";

export function activationRuntime(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gov002-${prefix}-`));
}

function commit(root, message, date) {
  git(root, ["add", "-A"], { write: true });
  git(root, ["-c", "user.name=Activation Fixture", "-c", "user.email=activation@example.invalid", "commit", "--no-gpg-sign", "-m", message], { write: true, env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return resolveCommit(root);
}

export function createActivationController(root) {
  const controller = path.join(root, "controller"); fs.mkdirSync(controller); git(controller, ["init", "-b", "main"], { write: true }); fs.writeFileSync(path.join(controller, "README.md"), "# Disposable activation controller\n");
  const commitId = commit(controller, "activation controller", "2026-09-22T06:00:00.000Z");
  git(controller, ["remote", "add", "origin", APPROVED_CONTROLLER_ORIGIN], { write: true }); git(controller, ["update-ref", "refs/remotes/origin/main", commitId], { write: true }); git(controller, ["branch", "--set-upstream-to=origin/main", "main"], { write: true });
  return { root: controller, commit: commitId };
}

export function createActivationTarget(root) {
  const target = path.join(root, "target"); fs.mkdirSync(target); git(target, ["init", "-b", "main"], { write: true }); fs.writeFileSync(path.join(target, "README.md"), "# Disposable activation target\n");
  const baseline = commit(target, "target baseline", "2026-09-22T06:01:00.000Z");
  git(target, ["branch", "self-improvement", baseline], { write: true }); git(target, ["update-ref", "refs/remotes/origin/main", baseline], { write: true }); git(target, ["update-ref", "refs/remotes/origin/self-improvement", baseline], { write: true }); git(target, ["checkout", "self-improvement"], { write: true });
  return { root: target, baseline };
}

export function activationFixture(prefix = "activation") {
  const root = fs.realpathSync(activationRuntime(prefix)); const controller = createActivationController(root); const target = createActivationTarget(root); const authorityPath = path.join(root, "authority"); fs.mkdirSync(authorityPath, { mode: 0o700 }); const authorityRoot = fs.realpathSync(authorityPath);
  const request = { schemaVersion: 1, requestId: `${prefix}-request`, repositoryId: `${prefix}-repository`, targetRoot: target.root, targetBranch: "self-improvement", baselineCommit: target.baseline, evidenceMode: "HUMAN_ASSISTED", createdAt: "2026-09-22T06:02:00.000Z" };
  const approval = { source: "HUMAN_OPERATOR", reference: `${prefix}-human-approval`, statement: expectedHumanApprovalStatement(request) };
  return { root, controller, target, authorityRoot, statePath: path.join(authorityRoot, "authority-state.json"), request, approval };
}

export function writeJson(root, name, value) { const file = path.join(root, name); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); return file; }
