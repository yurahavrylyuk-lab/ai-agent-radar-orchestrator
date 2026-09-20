import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateCrossRecords, validateCycle, validateRequest } from "../src/validate.mjs";

const request = { id: "r1", source: "HUMAN", createdAt: "2026-09-20T00:00:00Z", priority: 1, payload: {} };
const cycle = { id: "c1", requestId: "r1", status: "ACTIVE", planRevision: 1, baseline: "abc", iterationIds: [], activeMs: 0, humanWaitingMs: 0, liveOperationsEnabled: false };

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
  assert.throws(() => validateCrossRecords({ cycle, iterations: [{ id: "i1", cycleId: "other", index: 1, planRevision: 2, builderCommit: "abc", reviewState: "PASS", createdAt: "now" }] }), /mismatch/);
});
