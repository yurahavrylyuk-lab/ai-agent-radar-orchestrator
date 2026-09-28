import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { OfflineFixtureTransport } from "../src/adapters/offline-fixture.mjs";
import { applyAiRadarSearch10, AI_RADAR_PROTECTED_ROOT, AI_RADAR_SEARCH10_ALLOWED_CHANGES, AI_RADAR_SEARCH10_BASELINE, AI_RADAR_SEARCH10_BRANCH, AI_RADAR_SEARCH10_QUERIES, AI_RADAR_SEARCH10_SCENARIO, validateAiRadarSearch10Source } from "../src/scenarios/ai-radar-search10.mjs";
import { git, statusPorcelain } from "../src/git-evidence.mjs";

function disposableClone() {
  const root = fs.mkdtempSync("/private/tmp/ai-radar-search10-unit-"); const repository = path.join(root, "repository");
  git(root, ["clone", "--no-local", "--no-hardlinks", "--branch", AI_RADAR_SEARCH10_BRANCH, "--single-branch", AI_RADAR_PROTECTED_ROOT, repository], { write: true });
  git(repository, ["remote", "remove", "origin"], { write: true });
  return { root, repository };
}

test("scenario fixes the exact baseline, four-file allowlist, and ordered ten-query inventory", () => {
  assert.equal(AI_RADAR_SEARCH10_BASELINE, "33a60a1f74960f9c171f5449627db1be362c6481");
  assert.deepEqual(AI_RADAR_SEARCH10_ALLOWED_CHANGES, [
    { path: "src/services/monitor.ts", operation: "MODIFY" },
    { path: "src/tools/webSearch.ts", operation: "MODIFY" },
    { path: "test/monitor.test.ts", operation: "MODIFY" },
    { path: "test/webSearch.test.ts", operation: "ADD" },
  ]);
  assert.deepEqual(AI_RADAR_SEARCH10_QUERIES, [
    "AI news research product announcements", "AI agent framework releases", "AI model releases capabilities", "AI programming software development techniques", "AI developer tools releases", "Claude developer features releases", "Codex coding features releases", "AI coding tools releases", "AI assisted development workflow examples", "useful AI IT tools workflow tutorials",
  ]);
});

test("source admission accepts only a clean independent disposable clone at the fixed branch and baseline", () => {
  const fixture = disposableClone();
  try {
    const identity = validateAiRadarSearch10Source(fixture.repository);
    assert.equal(identity.commit, AI_RADAR_SEARCH10_BASELINE); assert.equal(identity.branch, AI_RADAR_SEARCH10_BRANCH); assert.equal(identity.independentGit, true); assert.equal(identity.clean, true);
    const alias = path.join(fixture.root, "alias"); fs.symlinkSync(fixture.repository, alias);
    assert.throws(() => validateAiRadarSearch10Source(alias), /SOURCE_ROOT_INVALID/u);
    assert.throws(() => validateAiRadarSearch10Source(AI_RADAR_PROTECTED_ROOT), /DISPOSABLE_SOURCE_REQUIRED|PROTECTED_SOURCE_FORBIDDEN/u);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("named Builder operation applies only the exact reviewed post-images and rejects replay", () => {
  const fixture = disposableClone();
  try {
    const result = applyAiRadarSearch10(fixture.repository);
    assert.equal(result.operation, "apply_ai_radar_search10"); assert.deepEqual(result.changedFiles, AI_RADAR_SEARCH10_ALLOWED_CHANGES);
    assert.deepEqual(statusPorcelain(fixture.repository).split("\0").filter(Boolean).map((entry) => entry.slice(3)), AI_RADAR_SEARCH10_ALLOWED_CHANGES.map((item) => item.path));
    assert.throws(() => applyAiRadarSearch10(fixture.repository), /PRECONDITION_FAILED/u);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("fixture transport exposes only the fixed named search10 operation", () => {
  const transport = new OfflineFixtureTransport({ scenario: AI_RADAR_SEARCH10_SCENARIO });
  const task = { purpose: "BUILDER_IMPLEMENTATION", iteration: 1, taskDigest: "a".repeat(64), repositoryId: "offline-repository:ai-radar-search10:test" };
  const frame = transport.execute(task, { records: [] }, { executionId: "execution:test" });
  assert.equal(frame.type, "tool_request");
  assert.deepEqual(frame.payload, { operation: "apply_ai_radar_search10", scenario: AI_RADAR_SEARCH10_SCENARIO });
  assert.equal("path" in frame.payload, false); assert.equal("content" in frame.payload, false); assert.equal("command" in frame.payload, false);
});
