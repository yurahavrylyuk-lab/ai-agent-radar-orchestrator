import { immutable } from "./contracts.mjs";
import { validateRequest } from "./validate.mjs";

function compareRequests(a, b) {
  const sourceOrder = { HUMAN: 0, SCHEDULED: 1 };
  return sourceOrder[a.source] - sourceOrder[b.source]
    || Date.parse(a.createdAt) - Date.parse(b.createdAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function orderRequests(queue) {
  if (!Array.isArray(queue)) throw new TypeError("queue must be an array");
  queue.forEach(validateRequest);
  if (new Set(queue.map((request) => request.id)).size !== queue.length) throw new TypeError("duplicate queued request id");
  return immutable([...queue].sort(compareRequests));
}
export function enqueue(queue, request) {
  validateRequest(request);
  return orderRequests([...queue, request]);
}
export function dequeue(queue, { activeCycleId = null, humanHold = false, now = null } = {}) {
  const ordered = orderRequests(queue);
  if (activeCycleId || humanHold || ordered.length === 0) return { request: null, queue: ordered };
  const index = ordered.findIndex((request) => request.source === "HUMAN" || (now !== null && scheduledOpportunity(now, request.scheduledFor).create));
  if (index === -1) return { request: null, queue: ordered };
  return { request: immutable(ordered[index]), queue: immutable(ordered.filter((_, candidate) => candidate !== index)) };
}
export function scheduledOpportunity(now, scheduledFor) {
  if (!Number.isFinite(Date.parse(now)) || !Number.isFinite(Date.parse(scheduledFor))) throw new TypeError("schedule timestamps must be valid");
  return now === scheduledFor ? { create: true } : { create: false, reason: "NO_CATCH_UP" };
}
