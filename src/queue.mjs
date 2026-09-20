import { immutable } from "./contracts.mjs";
import { validateRequest } from "./validate.mjs";

export function enqueue(queue, request) {
  validateRequest(request);
  return immutable([...queue, request].sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
}
export function dequeue(queue, { activeCycleId = null, humanHold = false } = {}) {
  if (activeCycleId || humanHold || queue.length === 0) return { request: null, queue: immutable(queue) };
  return { request: immutable(queue[0]), queue: immutable(queue.slice(1)) };
}
export function scheduledOpportunity(now, scheduledFor) {
  return now === scheduledFor ? { create: true } : { create: false, reason: "NO_CATCH_UP" };
}
