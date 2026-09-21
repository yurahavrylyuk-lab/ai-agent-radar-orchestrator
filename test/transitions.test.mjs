import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { admitNextCycle, replaceStateAtomic } from "../src/local-store.mjs";
import { nextReviewIteration, transitionCycle } from "../src/transitions.mjs";

const cycle = { id: "c", requestId: "r", status: "QUEUED", planRevision: 4, baseline: "abc", iterationIds: [], activeMs: 0, humanWaitingMs: 0, liveOperationsEnabled: false };
test("4 exactly one cycle admission is represented by one active-cycle slot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov002-transition-admit-")), statePath = path.join(dir, "state.json"), lockPath = path.join(dir, "controller.lock");
  const request = { id: "r", source: "HUMAN", createdAt: "2026-09-21T00:00:00Z", priority: 0, payload: {} };
  replaceStateAtomic(statePath, { schemaVersion: 1, controllerId: "owner", stateVersion: 0, owner: { id: "owner", generation: 1 }, activeCycleId: null, humanHold: false, queue: [request], cycles: [] });
  const args = { statePath, lockPath, claim: { ownerId: "owner", generation: 1, stateVersion: 0 }, cycle: { ...cycle, status: "ACTIVE" }, now: request.createdAt };
  assert.equal(admitNextCycle(args).status, "ADMITTED");
  assert.equal(admitNextCycle({ ...args, claim: { ...args.claim, stateVersion: 1 }, cycle: { ...args.cycle, id: "c2" } }).status, "ACTIVE_CYCLE_PRESENT");
  fs.rmSync(dir, { recursive: true });
});
test("5 illegal transitions fail without mutating cycle", () => {
  const before = structuredClone(cycle); assert.throws(() => transitionCycle(cycle, "ACCEPTED"), /Illegal/); assert.deepEqual(cycle, before);
});
test("6 third unresolved review escalates and prevents iteration four", () => {
  const result = nextReviewIteration({ ...cycle, status: "REVIEW", iterationIds: ["i1", "i2", "i3"] }, "REVISE"); assert.equal(result.status, "ESCALATED");
  assert.throws(() => nextReviewIteration({ ...cycle, status: "REVIEW", iterationIds: ["i1", "i2", "i3", "i4"] }, "REVISE"), /three/);
  assert.throws(() => transitionCycle({ ...cycle, iterationIds: ["i1", "i1"] }, "ACTIVE"), /duplicate/);
});
