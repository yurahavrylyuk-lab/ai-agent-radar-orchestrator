import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { resolveCommit } from "../src/git-evidence.mjs";
import { readState } from "../src/local-store.mjs";
import { prepareAcceptedActivation } from "./helpers/activation-cycle.mjs";

test("concurrent trusted integration consumes exactly one permission and performs one target update", async () => {
  const fixture = prepareAcceptedActivation("integration-concurrent"); const helper = path.resolve("test/helpers/activation-integration-contender.mjs");
  const launch = (now) => new Promise((resolve) => { const child = spawn("/usr/local/bin/node", [helper, fixture.statePath, fixture.cycleId, fixture.controller.root, now], { encoding: "utf8" }); let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.on("close", (status) => resolve({ status, stdout, stderr })); });
  const attempts = await Promise.all([launch("2026-09-22T11:00:00.000Z"), launch("2026-09-22T11:00:01.000Z")]);
  assert.equal(attempts.filter((item) => item.status === 0).length >= 1, true);
  const state = readState(fixture.statePath); assert.equal(state.authorizations[0].lifecycle.status, "CONSUMED"); assert.equal(state.authorizations[0].lifecycle.integratedCommit, fixture.candidateCommit); assert.equal(state.integrationIntents.length, 1); assert.equal(state.integrationOutcomes.filter((item) => item.status === "INTEGRATED").length, 1); assert.equal(state.summaries.filter((item) => item.type === "FINAL").length, 1); assert.equal(resolveCommit(fixture.target.root), fixture.candidateCommit);
});
