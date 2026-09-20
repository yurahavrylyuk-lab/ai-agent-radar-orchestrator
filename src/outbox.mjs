import crypto from "node:crypto";

export function payloadHash(payload) { return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"); }
export function appendEvent(events, event) {
  const existing = events.find((item) => item.id === event.id);
  if (!existing) return [...events, structuredClone(event)];
  if (payloadHash(existing.payload) !== payloadHash(event.payload)) throw new Error("CONFLICTING_EVENT_PAYLOAD");
  return structuredClone(events);
}
export function markNotification(events, eventId, status) {
  return events.map((event) => event.id === eventId ? { ...event, notificationStatus: status } : { ...event });
}
