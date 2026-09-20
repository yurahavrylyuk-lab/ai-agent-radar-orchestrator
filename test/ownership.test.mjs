import assert from "node:assert/strict";
import test from "node:test";
import { assertOwnership } from "../src/ownership.mjs";
import { dequeue } from "../src/queue.mjs";

const state = { owner: { id: "owner", generation: 2 }, stateVersion: 4 };
test("14 stale generation, wrong owner, and wrong state version fail closed", () => {
  assert.throws(() => assertOwnership(state, { ownerId: "owner", generation: 1, stateVersion: 4 }), /STALE/);
  assert.throws(() => assertOwnership(state, { ownerId: "other", generation: 2, stateVersion: 4 }), /WRONG_OWNER/);
  assert.throws(() => assertOwnership(state, { ownerId: "owner", generation: 2, stateVersion: 3 }), /WRONG_STATE/);
});
test("15 human hold durably prevents new admissions", () => {
  assert.equal(dequeue([{ id: "r" }], { humanHold: true }).request, null);
});
