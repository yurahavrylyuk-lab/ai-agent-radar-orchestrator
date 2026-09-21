import crypto from "node:crypto";

function canonicalJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("event payload must not be cyclic");
    seen.add(value);
    const result = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    if (seen.has(value)) throw new TypeError("event payload must not be cyclic");
    seen.add(value);
    const result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`).join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new TypeError("event payload must contain only finite JSON values");
}
export function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("event must be an object");
  if (typeof event.id !== "string" || event.id.length === 0) throw new TypeError("event.id must be a non-empty string");
  canonicalJson(event.payload);
  return true;
}
export function payloadHash(payload) { return crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex"); }
export function canonicalEqual(left, right) { return payloadHash(left) === payloadHash(right); }
export function appendEvent(events, event) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  events.forEach(validateEvent);
  const identities = new Map();
  for (const existingEvent of events) {
    const existingDigest = identities.get(existingEvent.id);
    const digest = payloadHash(existingEvent.payload);
    if (existingDigest !== undefined) throw new Error(existingDigest === digest ? "DUPLICATE_EXISTING_EVENT_ID" : "CONFLICTING_EXISTING_EVENT_PAYLOAD");
    identities.set(existingEvent.id, digest);
  }
  validateEvent(event);
  const existing = events.find((item) => item.id === event.id);
  if (!existing) return [...events, structuredClone(event)];
  if (payloadHash(existing.payload) !== payloadHash(event.payload)) throw new Error("CONFLICTING_EVENT_PAYLOAD");
  return structuredClone(events);
}
export function markNotification(events, eventId, status) {
  return events.map((event) => event.id === eventId ? { ...event, notificationStatus: status } : { ...event });
}
