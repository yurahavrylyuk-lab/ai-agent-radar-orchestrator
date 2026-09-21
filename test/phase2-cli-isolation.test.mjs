import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { initializeStateV2 } from "../src/local-store.mjs";
import { analystState, approval, runtimeDirectory } from "./helpers/phase2-fixture.mjs";

const cli = path.resolve("src/cli.mjs");
function run(args) { return spawnSync("/usr/local/bin/node", [cli, ...args], { encoding: "utf8", env: { ...process.env, GEMINI_API_KEY: "must-not-be-used", BRAVE_SEARCH_API_KEY: "must-not-be-used", RESEND_API_KEY: "must-not-be-used" } }); }

test("next-task only renders the persisted task and launches no role or provider", () => {
  const root = runtimeDirectory("cli"); const statePath = path.join(root, "state.json"); initializeStateV2(statePath, analystState(root).state); const before = fs.readFileSync(statePath); const result = run(["next-task", "--state", statePath]); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /expectedResponseEnvelope/); assert.match(result.stdout, /ANALYST_REVIEW/); assert.deepEqual(fs.readFileSync(statePath), before);
});
test("status distinguishes simulated evidence, pending role, completed timing, and local integration state", () => {
  const root = runtimeDirectory("cli-status"); const statePath = path.join(root, "state.json"); initializeStateV2(statePath, analystState(root).state); const result = run(["status", "--state", statePath]); assert.equal(result.status, 0); const status = JSON.parse(result.stdout); assert.equal(status.evidenceMode, "SIMULATED"); assert.equal(status.pendingRole, "analyst"); assert.equal(status.roleStatus, "COMPLETED"); assert.equal(status.integrationStatus, "NOT_STARTED");
});
test("real-target initialization is refused and creates no state", () => {
  const root = runtimeDirectory("cli-real-refusal"); const statePath = path.join(root, "state.json"); const configPath = path.join(root, "config.json"); fs.writeFileSync(configPath, JSON.stringify({ controllerId: "controller", repositoryId: "real", evidenceMode: "HUMAN_ASSISTED", ownerId: "owner", targetRoot: "/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent", approval })); const result = run(["init", "--state", statePath, "--file", configPath]); assert.equal(result.status, 2); assert.match(result.stderr, /REAL_PILOT_NOT_AUTHORIZED/); assert.equal(fs.existsSync(statePath), false);
});
test("Phase 2 source contains no provider, email, scheduler, deployment, or role-launch adapter", () => {
  const files = fs.readdirSync("src").filter((name) => name.endsWith(".mjs")); const text = files.map((name) => fs.readFileSync(path.join("src", name), "utf8")).join("\n");
  for (const forbidden of ["api.openai.com", "generativelanguage.googleapis.com", "api.search.brave.com", "api.resend.com", "wrangler deploy", "scheduled("]) assert.equal(text.includes(forbidden), false, forbidden);
});
