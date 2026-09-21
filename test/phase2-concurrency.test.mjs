import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { initializeStateV2, readState } from "../src/local-store.mjs";
import { analystPayload, analystState, makeResult, OID_B, runtimeDirectory } from "./helpers/phase2-fixture.mjs";

function run(script, args) { return new Promise((resolve) => { const child = spawn("/usr/local/bin/node", [script, ...args], { stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.on("close", (status) => resolve({ status, stdout, stderr })); }); }

test("two real processes competing for one task produce one accepted transaction", async () => {
  const root = runtimeDirectory("concurrency"); const statePath = path.join(root, "state.json"); const resultPath = path.join(root, "result.json"); const { state, task } = analystState(root); initializeStateV2(statePath, state); fs.writeFileSync(resultPath, `${JSON.stringify(makeResult(task, analystPayload(state, task, "PASS")), null, 2)}\n`);
  const script = fileURLToPath(new URL("./helpers/phase2-submit-contender.mjs", import.meta.url)); const outcomes = await Promise.all([run(script, [statePath, resultPath]), run(script, [statePath, resultPath])]);
  assert.equal(outcomes.filter((item) => item.status === 0).length, 1); assert.match(outcomes.find((item) => item.status === 0).stdout, /SUBMISSION_ACCEPTED/); assert.equal(outcomes.filter((item) => item.status === 2).length, 1);
  const persisted = readState(statePath); assert.equal(persisted.receipts.length, 1); assert.equal(persisted.summaries.length, 1); assert.equal(persisted.outbox.length, 1);
});
