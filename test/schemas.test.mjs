import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateCrossRecords, validateCycle, validateIteration, validateMachineState, validateRequest } from "../src/validate.mjs";

const request = { id: "r1", source: "HUMAN", createdAt: "2026-09-20T00:00:00Z", priority: 1, payload: {} };
const cycle = { id: "c1", requestId: "r1", status: "ACTIVE", planRevision: 4, baseline: "abc", iterationIds: [], activeMs: 0, humanWaitingMs: 0, liveOperationsEnabled: false };
const iteration = (overrides = {}) => ({ id: "i1", cycleId: "c1", index: 1, planRevision: 4, builderCommit: "abc", reviewState: "PASS", createdAt: "2026-09-21T00:00:00Z", ...overrides });

test("1 schema files are strict and complete", () => {
  const files = fs.readdirSync(new URL("../schemas", import.meta.url)).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 8);
  for (const file of files.filter((name) => name !== "definitions.schema.json")) assert.equal(JSON.parse(fs.readFileSync(new URL(`../schemas/${file}`, import.meta.url))).additionalProperties, false);
});
test("2 runtime validators reject missing, mistyped, and unknown fields", () => {
  assert.equal(validateRequest(request), true);
  assert.throws(() => validateRequest({ ...request, unexpected: true }), /unknown field/);
  assert.throws(() => validateCycle({ ...cycle, planRevision: "1" }), /integer/);
});
test("3 cross-record validation rejects identity and revision mismatch", () => {
  assert.throws(() => validateCrossRecords({ cycle: { ...cycle, iterationIds: ["i1"] }, iterations: [iteration({ cycleId: "other" })] }), /mismatch/);
});
test("33 runtime iteration validation accepts only safe indices one through three without capping plan revision", () => {
  for (const index of [1, 2, 3]) assert.equal(validateIteration(iteration({ index })), true);
  for (const index of [0, -1, 1.5, "1", 4, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validateIteration(iteration({ index })), /iteration.index|integer/);
  assert.equal(validateIteration(iteration({ planRevision: 4 })), true);
});
test("34 cycle and cross-record iteration caps reject duplicates, excess, and disguised iteration four", () => {
  assert.throws(() => validateCycle({ ...cycle, iterationIds: ["i1", "i2", "i3", "i4"] }), /three/);
  assert.throws(() => validateCycle({ ...cycle, iterationIds: ["i1", "i1"] }), /duplicate/);
  const records = [iteration(), iteration({ id: "i2", index: 2 }), iteration({ id: "i3", index: 3 })];
  assert.equal(validateCrossRecords({ cycle: { ...cycle, iterationIds: ["i1", "i2", "i3"] }, iterations: records }), true);
  assert.throws(() => validateCrossRecords({ cycle: { ...cycle, iterationIds: ["i1", "i2"] }, iterations: [...records, iteration({ id: "i4", index: 4 })] }), /three|<= 3/);
  assert.throws(() => validateCrossRecords({ cycle: { ...cycle, iterationIds: ["i1", "i2"] }, iterations: [iteration(), iteration({ id: "i2", index: 1 })] }), /duplicate iteration index/);
  assert.throws(() => validateCrossRecords({ cycle: { ...cycle, iterationIds: ["i1"] }, iterations: [iteration(), iteration({ id: "i2", index: 2 })] }), /iterationIds mismatch/);
});
test("35 machine state binds unique cycles, claimed requests, and active references", () => {
  const state = { schemaVersion: 1, controllerId: "owner", stateVersion: 0, owner: { id: "owner", generation: 1 }, activeCycleId: "c1", humanHold: false, queue: [], cycles: [cycle] };
  assert.equal(validateMachineState(state), true);
  assert.throws(() => validateMachineState({ ...state, activeCycleId: "missing" }), /activeCycleId/);
  assert.throws(() => validateMachineState({ ...state, cycles: [cycle, { ...cycle, id: "c2" }] }), /claimed request/);
});
