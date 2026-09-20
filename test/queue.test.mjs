import assert from "node:assert/strict";
import test from "node:test";
import { dequeue, enqueue, scheduledOpportunity } from "../src/queue.mjs";

const req = (id, source, priority, createdAt) => ({ id, source, priority, createdAt, payload: {} });
test("11 human requests queue behind active work", () => {
  const queue = enqueue([], req("human", "HUMAN", 10, "2026-01-01T00:00:00Z")); assert.equal(dequeue(queue, { activeCycleId: "active" }).request, null);
});
test("12 human priority and deterministic ordering", () => {
  let queue = enqueue([], req("scheduled", "SCHEDULED", 1, "2026-01-01T00:00:00Z")); queue = enqueue(queue, req("human", "HUMAN", 10, "2026-01-02T00:00:00Z")); assert.equal(queue[0].id, "human");
});
test("13 missed schedules create no catch-up request", () => {
  assert.deepEqual(scheduledOpportunity("later", "earlier"), { create: false, reason: "NO_CATCH_UP" });
});
