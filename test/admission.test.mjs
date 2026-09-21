import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { admitNextCycle, PersistenceDurabilityUncertainError, readState, replaceStateAtomic } from "../src/local-store.mjs";

const now = "2026-09-21T08:00:00Z";
const request = (overrides = {}) => ({ id: "r1", source: "HUMAN", createdAt: now, priority: 0, payload: {}, ...overrides });
const cycle = (overrides = {}) => ({ id: "c1", requestId: "r1", status: "ACTIVE", planRevision: 4, baseline: "baseline", iterationIds: [], activeMs: 0, humanWaitingMs: 0, liveOperationsEnabled: false, ...overrides });
const state = (overrides = {}) => ({ schemaVersion: 1, controllerId: "owner", stateVersion: 0, owner: { id: "owner", generation: 1 }, activeCycleId: null, humanHold: false, queue: [request()], cycles: [], ...overrides });
function temporary() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov002-admission-")); return { dir, statePath: path.join(dir, "state.json"), lockPath: path.join(dir, "controller.lock") }; }
function args(paths, overrides = {}) { return { ...paths, claim: { ownerId: "owner", generation: 1, stateVersion: 0 }, cycle: cycle(), now, ...overrides }; }
function runChild(helper, argv) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [helper, ...argv], { stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject); child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("43 concurrent processes admit exactly one cycle and advance one version", async () => {
  const paths = temporary(); replaceStateAtomic(paths.statePath, state());
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), "helpers", "admission-contender.mjs");
  const results = await Promise.all([
    runChild(helper, [paths.statePath, paths.lockPath, "cycle-a", "r1", now]),
    runChild(helper, [paths.statePath, paths.lockPath, "cycle-b", "r1", now]),
  ]);
  for (const result of results) { assert.equal(result.status, 0, result.stderr); assert.doesNotThrow(() => JSON.parse(result.stdout)); }
  assert.equal(results.map((result) => JSON.parse(result.stdout).status).filter((status) => status === "ADMITTED").length, 1);
  const persisted = readState(paths.statePath); assert.equal(persisted.stateVersion, 1); assert.equal(persisted.cycles.length, 1); assert.equal(persisted.queue.length, 0); assert.equal(persisted.activeCycleId, persisted.cycles[0].id); fs.rmSync(paths.dir, { recursive: true });
});
test("44 holds and ineligible schedules prevent admission regardless of caller claims", () => {
  const held = temporary(); replaceStateAtomic(held.statePath, state({ humanHold: true })); const heldBefore = fs.readFileSync(held.statePath);
  assert.equal(admitNextCycle({ ...args(held), eligible: true }).status, "HUMAN_HOLD"); assert.deepEqual(fs.readFileSync(held.statePath), heldBefore); fs.rmSync(held.dir, { recursive: true });
  const scheduled = temporary(); const scheduledRequest = request({ source: "SCHEDULED", scheduledFor: "2026-09-22T08:00:00Z" }); replaceStateAtomic(scheduled.statePath, state({ queue: [scheduledRequest] }));
  assert.equal(admitNextCycle({ ...args(scheduled), eligible: true }).status, "NO_ELIGIBLE_REQUEST"); assert.equal(readState(scheduled.statePath).stateVersion, 0); fs.rmSync(scheduled.dir, { recursive: true });
});
test("45 stale ownership/version and duplicate identities fail without state changes", () => {
  for (const claim of [{ ownerId: "owner", generation: 2, stateVersion: 0 }, { ownerId: "owner", generation: 1, stateVersion: 1 }]) {
    const paths = temporary(); replaceStateAtomic(paths.statePath, state()); const before = fs.readFileSync(paths.statePath);
    assert.throws(() => admitNextCycle(args(paths, { claim })), /STALE|WRONG_STATE/); assert.deepEqual(fs.readFileSync(paths.statePath), before); assert.equal(fs.existsSync(paths.lockPath), false); fs.rmSync(paths.dir, { recursive: true });
  }
  const existing = cycle({ id: "used-cycle", requestId: "used-request", status: "ACCEPTED" });
  const duplicateCycle = temporary(); replaceStateAtomic(duplicateCycle.statePath, state({ cycles: [existing] }));
  assert.throws(() => admitNextCycle(args(duplicateCycle, { cycle: cycle({ id: "used-cycle" }) })), /CYCLE_ID_ALREADY_USED/); fs.rmSync(duplicateCycle.dir, { recursive: true });
  const duplicateRequest = temporary(); replaceStateAtomic(duplicateRequest.statePath, state({ cycles: [existing] }));
  assert.throws(() => admitNextCycle(args(duplicateRequest, { cycle: cycle({ requestId: "used-request" }) })), /REQUEST_ALREADY_CLAIMED/); fs.rmSync(duplicateRequest.dir, { recursive: true });
});
test("46 admission distinguishes pre-rename failure from post-rename uncertainty and never retries", () => {
  const beforeRename = temporary(); replaceStateAtomic(beforeRename.statePath, state()); const before = fs.readFileSync(beforeRename.statePath);
  assert.throws(() => admitNextCycle(args(beforeRename, { persistenceOptions: { failBeforeRename: true } })), /BEFORE_RENAME/); assert.deepEqual(fs.readFileSync(beforeRename.statePath), before); assert.equal(fs.existsSync(beforeRename.lockPath), false); fs.rmSync(beforeRename.dir, { recursive: true });
  const afterRename = temporary(); replaceStateAtomic(afterRename.statePath, state());
  assert.throws(() => admitNextCycle(args(afterRename, { persistenceOptions: { failAfterRename: true } })), (error) => error instanceof PersistenceDurabilityUncertainError);
  assert.equal(fs.existsSync(afterRename.lockPath), false); assert.equal(readState(afterRename.statePath).stateVersion, 1);
  const result = admitNextCycle(args(afterRename, { claim: { ownerId: "owner", generation: 1, stateVersion: 1 }, cycle: cycle({ id: "c2" }) })); assert.equal(result.status, "ACTIVE_CYCLE_PRESENT"); assert.equal(readState(afterRename.statePath).stateVersion, 1); fs.rmSync(afterRename.dir, { recursive: true });
});
