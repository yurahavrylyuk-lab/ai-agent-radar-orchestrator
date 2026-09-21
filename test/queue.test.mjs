import assert from "node:assert/strict";
import test from "node:test";
import { dequeue, enqueue, scheduledOpportunity } from "../src/queue.mjs";

const req = (id, source, priority, createdAt) => ({ id, source, priority, createdAt, payload: {} });
test("11 human requests queue behind active work", () => {
  const queue = enqueue([], req("human", "HUMAN", 10, "2026-01-01T00:00:00Z")); assert.equal(dequeue(queue, { activeCycleId: "active" }).request, null);
});
test("12 human priority and deterministic ordering", () => {
  let queue = enqueue([], { ...req("scheduled", "SCHEDULED", 99, "2026-01-01T00:00:00Z"), scheduledFor: "2026-01-01T00:00:00Z" }); queue = enqueue(queue, req("human", "HUMAN", 0, "2026-01-02T00:00:00Z")); assert.deepEqual(queue.map((item) => item.id), ["human", "scheduled"]);
});
test("36 caller priority cannot outrank source, timestamps, or stable IDs", () => {
  const requests = [
    { ...req("s-late", "SCHEDULED", Number.MAX_SAFE_INTEGER, "2026-01-02T00:00:00Z"), scheduledFor: "2026-01-02T00:00:00Z" },
    req("h-b", "HUMAN", Number.MAX_SAFE_INTEGER, "2026-01-02T00:00:00Z"),
    req("h-a", "HUMAN", 0, "2026-01-02T00:00:00Z"),
    { ...req("s-early", "SCHEDULED", 0, "2026-01-01T00:00:00Z"), scheduledFor: "2026-01-01T00:00:00Z" },
    req("h-early", "HUMAN", 99, "2026-01-01T00:00:00Z"),
  ];
  let queue = []; for (const request of requests) queue = enqueue(queue, request);
  assert.deepEqual(queue.map((item) => item.id), ["h-early", "h-a", "h-b", "s-early", "s-late"]);
});
test("37 dequeue reorders directly supplied queues and rejects malformed timestamps", () => {
  const scheduled = { ...req("scheduled", "SCHEDULED", 99, "2026-01-01T00:00:00Z"), scheduledFor: "2026-01-01T00:00:00Z" };
  const human = req("human", "HUMAN", 0, "2026-01-02T00:00:00Z");
  assert.equal(dequeue([scheduled, human], { now: scheduled.scheduledFor }).request.id, "human");
  assert.throws(() => enqueue([], req("bad", "HUMAN", 0, "not-a-time")), /timestamp/);
});
test("13 missed schedules create no catch-up request", () => {
  assert.deepEqual(scheduledOpportunity("2026-09-21T08:00:01Z", "2026-09-21T08:00:00Z"), { create: false, reason: "NO_CATCH_UP" });
});
