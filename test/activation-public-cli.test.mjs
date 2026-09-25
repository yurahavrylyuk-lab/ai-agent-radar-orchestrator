import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const cli = path.resolve("src/cli.mjs");
const node = "/usr/local/bin/node";
const git = "/usr/bin/git";
const approvedOrigin = "https://github.com/yurahavrylyuk-lab/ai-agent-radar-orchestrator.git";
const pilotPath = "docs/learning/offline-fixture-reading.md";
const disposableEnv = { GOV002_TEST_DISPOSABLE_AUTHORITY: "1", GEMINI_API_KEY: "must-not-be-used", BRAVE_SEARCH_API_KEY: "must-not-be-used", RESEND_API_KEY: "must-not-be-used" };

function run(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: "utf8", env: { ...process.env, ...disposableEnv } });
  assert.equal(result.status, 0, `${program} ${args.join(" ")}\n${result.stderr}`); return result.stdout;
}
function writeJson(root, name, value) { const file = path.join(root, name); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); return file; }
function commit(root, message) { run(git, ["add", "-A"], root); run(git, ["-c", "user.name=CLI Fixture", "-c", "user.email=cli@example.invalid", "commit", "--no-gpg-sign", "-m", message], root); return run(git, ["rev-parse", "HEAD"], root).trim(); }

async function authorize({ cwd, statePath, requestFile, approvalFile }) {
  return await new Promise((resolve, reject) => {
    const child = spawn(node, [cli, "authorize-pilot", "--state", statePath, "--file", requestFile, "--approval-file", approvalFile], { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...disposableEnv } });
    let stdout = ""; let stderr = ""; let confirmed = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/"authorizationDigest":\s*"([0-9a-f]{64})"/u);
      if (match && !confirmed) { confirmed = true; child.stdin.end(`CONFIRM ${match[1]}\n`); }
    });
    child.on("error", reject);
    child.on("close", (status) => status === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`authorize-pilot failed (${status}): ${stderr}`)));
  });
}

test("public CLI completes one human-authorized disposable lifecycle and preserves exact candidate identity", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gov002-activation-public-cli-")));
  const controller = path.join(root, "controller"); fs.mkdirSync(controller); run(git, ["init", "-b", "main"], controller); fs.writeFileSync(path.join(controller, "README.md"), "# Disposable controller\n"); const controllerCommit = commit(controller, "controller release"); run(git, ["remote", "add", "origin", approvedOrigin], controller); run(git, ["update-ref", "refs/remotes/origin/main", controllerCommit], controller); run(git, ["branch", "--set-upstream-to=origin/main", "main"], controller);
  const target = path.join(root, "target"); fs.mkdirSync(target); run(git, ["init", "-b", "main"], target); fs.writeFileSync(path.join(target, "README.md"), "# Disposable target\n"); const baseline = commit(target, "target baseline"); run(git, ["branch", "self-improvement", baseline], target); run(git, ["update-ref", "refs/remotes/origin/main", baseline], target); run(git, ["update-ref", "refs/remotes/origin/self-improvement", baseline], target); run(git, ["checkout", "self-improvement"], target);
  const authorityRoot = path.join(root, "authority"); fs.mkdirSync(authorityRoot, { mode: 0o700 }); const statePath = path.join(fs.realpathSync(authorityRoot), "authority-state.json");
  const request = { schemaVersion: 1, requestId: "public-activation", repositoryId: "public-activation-repository", targetRoot: target, targetBranch: "self-improvement", baselineCommit: baseline, evidenceMode: "HUMAN_ASSISTED", createdAt: "2026-09-22T07:00:00.000Z" };
  const approval = { source: "HUMAN_OPERATOR", reference: "public-cli-human", statement: `I explicitly authorize one HUMAN_ASSISTED GOV-002 pilot for request ${request.requestId} and cycle cycle:${request.requestId} to ADD ${pilotPath} with a maximum of 800 words, using included subscription capacity only and no paid fallback.` };
  const requestFile = writeJson(root, "request.json", request); const approvalFile = writeJson(root, "approval.json", approval); const issued = await authorize({ cwd: controller, statePath, requestFile, approvalFile }); assert.equal(issued.status, "ISSUED");
  const command = (...args) => run(node, [cli, ...args, "--state", statePath], controller); command("show-authorization", "--authorization", issued.authorizationId); command("enqueue", "--file", requestFile);
  const prompt = () => JSON.parse(command("next-task"));
  const complete = (handoff, payload) => { command("start-role", "--task", handoff.task.taskId); command("finish-role", "--task", handoff.task.taskId); const resultFile = writeJson(root, `result-${handoff.task.taskId.replaceAll(":", "-")}.json`, { ...handoff.expectedResponseEnvelope, payload }); command("submit-result", "--file", resultFile); };
  let handoff = prompt(); complete(handoff, { ...handoff.expectedResponseEnvelope.payload, goal: "Create the bounded fictional offline fixture guide.", rationale: "The human-authorized request is exact and bounded." });
  handoff = prompt(); command("prepare-workspace", "--task", handoff.task.taskId, "--runtime", path.join(root, "workspace-runtime")); handoff = prompt(); command("start-role", "--task", handoff.task.taskId); const guide = path.join(handoff.executionContext.workspace.root, pilotPath); fs.mkdirSync(path.dirname(guide), { recursive: true }); fs.writeFileSync(guide, "# Reading Fictional Offline Fixtures\n\nThis fictional offline non-production learning guide compares record identifiers, titles, sources, and publication dates. It is non-governance and non-operational. A conceptual duplicate has the same normalized identifier and source; no live service is contacted.\n"); command("finish-role", "--task", handoff.task.taskId); command("checkpoint", "--task", handoff.task.taskId); handoff = prompt(); const validation = handoff.executionContext.requiredValidationEvidence.map((item) => item.attestationOptions.PASS); const builderResult = writeJson(root, "builder-result.json", { ...handoff.expectedResponseEnvelope, payload: { ...handoff.expectedResponseEnvelope.payload, validation } }); command("submit-result", "--file", builderResult);
  handoff = prompt(); command("prepare-workspace", "--task", handoff.task.taskId, "--runtime", path.join(root, "workspace-runtime")); handoff = prompt(); complete(handoff, { ...handoff.expectedResponseEnvelope.payload, reviewState: "PASS", findings: [], requiredChanges: [], recommendations: [], validation: handoff.executionContext.requiredValidationEvidence.map((item) => item.attestationOptions.PASS) });
  handoff = prompt(); complete(handoff, { ...handoff.expectedResponseEnvelope.payload, decision: "ACCEPT", rationale: "The exact reviewed candidate and successful attestations satisfy the authorization." });
  const integrated = JSON.parse(command("integrate-local", "--cycle", `cycle:${request.requestId}`)); assert.equal(integrated.status, "INTEGRATED"); assert.equal(run(git, ["rev-parse", "refs/heads/self-improvement"], target).trim(), integrated.candidateCommit); assert.equal(run(git, ["rev-parse", "HEAD"], target).trim(), integrated.candidateCommit); assert.equal(run(git, ["rev-parse", "refs/heads/main"], target).trim(), baseline); assert.equal(run(git, ["rev-parse", "refs/remotes/origin/main"], target).trim(), baseline); assert.equal(run(git, ["rev-parse", "refs/remotes/origin/self-improvement"], target).trim(), baseline); assert.equal(run(git, ["status", "--porcelain=v1"], target), `D  ${pilotPath}\n`); assert.equal(fs.existsSync(path.join(target, pilotPath)), false); assert.equal(integrated.checkoutCondition.status, "REF_ADVANCED_CHECKOUT_PRESERVED"); assert.equal(integrated.checkoutCondition.synchronizedToNewHead, false);
  const summary = JSON.parse(command("show-summary")); assert.equal(summary.evidenceMode, "HUMAN_ASSISTED"); assert.equal(summary.terminalState, "ACCEPTED"); assert.equal(summary.authorizationId, issued.authorizationId); assert.equal(summary.integration.newTip, integrated.candidateCommit); assert.equal(summary.changedPath, pilotPath); assert.equal(summary.productionImpact, "LOCAL_SELF_IMPROVEMENT_BRANCH_ONLY"); assert.equal(summary.checkoutCondition.status, "REF_ADVANCED_CHECKOUT_PRESERVED"); assert.equal(summary.protectedTargetComparison.status, "REF_ADVANCED_CHECKOUT_PRESERVED");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8")); assert.equal(state.authorizations[0].lifecycle.status, "CONSUMED"); assert.equal(state.authorizations[0].lifecycle.integratedCommit, integrated.candidateCommit); assert.equal(state.summaries.filter((item) => item.type === "ITERATION").length, 1); assert.equal(state.summaries.filter((item) => item.type === "FINAL").length, 1); assert.equal(state.outbox.every((item) => item.status === "SIMULATED_ACCEPTED"), true);
});
