import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = path.resolve("src/cli.mjs");
const node = "/usr/local/bin/node";
const git = "/usr/bin/git";

function run(program, args, cwd = process.cwd()) {
  const result = spawnSync(program, args, { cwd, encoding: "utf8", env: { ...process.env, GEMINI_API_KEY: "must-not-be-used", BRAVE_SEARCH_API_KEY: "must-not-be-used", RESEND_API_KEY: "must-not-be-used" } });
  assert.equal(result.status, 0, `${program} ${args.join(" ")}\n${result.stderr}`); return result.stdout;
}
function writeJson(root, name, value) { const file = path.join(root, name); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); return file; }

test("public CLI alone completes the disposable REVISE PASS ACCEPT workflow", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gov002-public-cli-")); const fixture = path.join(root, "fixture"); const runtime = path.join(root, "runtime"); const statePath = path.join(runtime, "state.json"); fs.mkdirSync(fixture); fs.mkdirSync(runtime);
  run(git, ["init", "-b", "main"], fixture); fs.writeFileSync(path.join(fixture, "README.md"), "# Disposable public CLI fixture\n"); run(git, ["add", "README.md"], fixture); run(git, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "baseline"], fixture); const baseline = run(git, ["rev-parse", "HEAD"], fixture).trim(); run(git, ["branch", "self-improvement", baseline], fixture); run(git, ["checkout", "self-improvement"], fixture);
  const approval = { approvalId: "gov-002-public-cli", scope: "Add the fictional offline fixture-reading guide only.", allowedChanges: [{ path: "docs/learning/offline-fixture-reading.md", operation: "ADD" }], forbiddenChanges: ["No providers", "No network", "No publication", "No scheduling", "No production"], acceptanceCriteria: [{ id: "criterion", description: "The offline guide is bounded." }], validationRequirements: [{ id: "validate-guide", description: "Verify the exact bounded offline guide candidate." }] };
  const initFile = writeJson(root, "init.json", { controllerId: "controller", repositoryId: "fixture-repository", evidenceMode: "SIMULATED", ownerId: "operator", targetRoot: fixture, approval });
  const requestFile = writeJson(root, "request.json", { schemaVersion: 2, requestId: "public-cli", repositoryId: "fixture-repository", targetRoot: fixture, targetBranch: "self-improvement", baselineCommit: baseline, createdAt: "2026-09-21T10:00:00.000Z" });
  const command = (...args) => run(node, [cli, ...args, "--state", statePath]); let tick = Date.parse("2026-09-21T10:00:00.000Z"); const now = () => new Date(tick += 1000).toISOString();
  command("init", "--file", initFile); command("enqueue", "--file", requestFile);
  const prompt = () => JSON.parse(command("next-task"));
  const executeAndSubmit = (handoff, payload) => { command("start-role", "--task", handoff.task.taskId, "--now", now()); command("finish-role", "--task", handoff.task.taskId, "--now", now()); const file = writeJson(root, `result-${handoff.task.taskId.replaceAll(":", "-")}.json`, { ...handoff.expectedResponseEnvelope, payload }); command("submit-result", "--file", file, "--now", now()); };
  const prepare = (handoff) => command("prepare-workspace", "--task", handoff.task.taskId, "--runtime", path.join(runtime, "workspace-runtime"), "--now", now());

  let handoff = prompt(); assert.equal(typeof handoff.expectedResponseEnvelope.payload, "object"); assert.deepEqual(handoff.operatorInstructions.allowedOutcomes, ["COMPLETED", "BLOCKED"]); const plan = { ...handoff.expectedResponseEnvelope.payload, goal: "Create a fictional offline guide.", rationale: "Bounded initial plan." }; executeAndSubmit(handoff, plan);
  handoff = prompt(); prepare(handoff); handoff = prompt(); assert.ok(handoff.executionContext.workspace.root); assert.ok("candidateCommit" in handoff.expectedResponseEnvelope.payload); command("start-role", "--task", handoff.task.taskId, "--now", now()); const guide = path.join(handoff.executionContext.workspace.root, "docs/learning/offline-fixture-reading.md"); fs.mkdirSync(path.dirname(guide), { recursive: true }); fs.writeFileSync(guide, "# Offline Fixture Reading\n\nThis fictional offline guide compares stable record identifiers.\n"); command("finish-role", "--task", handoff.task.taskId, "--now", now()); command("checkpoint", "--task", handoff.task.taskId, "--now", now()); handoff = prompt(); assert.equal(handoff.executionContext.requiredValidationEvidence[0].status, "READY"); assert.ok(handoff.expectedResponseEnvelope.payload.validation.every((entry) => entry.evidenceDigest)); executeAndSubmitAfterTiming(handoff);

  function executeAndSubmitAfterTiming(current) { const file = writeJson(root, `result-${current.task.taskId.replaceAll(":", "-")}.json`, current.expectedResponseEnvelope); command("submit-result", "--file", file, "--now", now()); }
  handoff = prompt(); prepare(handoff); handoff = prompt(); assert.equal(handoff.expectedResponseEnvelope.payload.reviewedCommit, handoff.executionContext.workspace.expectedCommit); assert.ok(handoff.expectedResponseEnvelope.payload.validation.length > 0); executeAndSubmit(handoff, { ...handoff.expectedResponseEnvelope.payload, reviewState: "REVISE", findings: ["The comparison fields are incomplete."], requiredChanges: ["Add source and publication fields."], recommendations: [] });
  handoff = prompt(); assert.ok(handoff.executionContext.actionablePrecedingEvidence.some((item) => item.content.payload?.requiredChanges?.includes("Add source and publication fields."))); executeAndSubmit(handoff, { ...handoff.expectedResponseEnvelope.payload, rationale: "Address the retained Analyst findings.", resolvesFindingIds: ["comparison-fields"] });

  handoff = prompt(); prepare(handoff); handoff = prompt(); command("start-role", "--task", handoff.task.taskId, "--now", now()); fs.writeFileSync(path.join(handoff.executionContext.workspace.root, "docs/learning/offline-fixture-reading.md"), "# Offline Fixture Reading\n\nThis fictional offline guide compares stable id, source, title, and publication fields without live access.\n"); command("finish-role", "--task", handoff.task.taskId, "--now", now()); command("checkpoint", "--task", handoff.task.taskId, "--now", now()); handoff = prompt(); executeAndSubmitAfterTiming(handoff);
  handoff = prompt(); prepare(handoff); handoff = prompt(); executeAndSubmit(handoff, { ...handoff.expectedResponseEnvelope.payload, reviewState: "PASS", findings: [], requiredChanges: [], recommendations: [] });
  handoff = prompt(); assert.ok(handoff.executionContext.actionablePrecedingEvidence.some((item) => item.content.payload?.reviewState === "PASS")); assert.ok(handoff.expectedResponseEnvelope.payload.analystResultDigest); executeAndSubmit(handoff, { ...handoff.expectedResponseEnvelope.payload, decision: "ACCEPT", rationale: "The retained Analyst conclusion passed." });
  const cycleId = "cycle:public-cli"; command("integrate-fixture", "--cycle", cycleId, "--target", fixture, "--now", now()); const summary = JSON.parse(command("show-summary")); assert.equal(summary.id, `summary:${cycleId}:final`); assert.equal(summary.terminalState, "ACCEPTED"); assert.equal(summary.terminalReason, "INTEGRATED");
  assert.equal(run(git, ["rev-parse", "main"], fixture).trim(), baseline); assert.equal(run(git, ["status", "--porcelain=v1"], fixture), "");
});
