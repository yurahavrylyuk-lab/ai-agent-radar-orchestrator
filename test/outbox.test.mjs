import assert from "node:assert/strict";
import test from "node:test";
import { appendEvent, markNotification } from "../src/outbox.mjs";
import { commitReviewBundle } from "../src/local-store.mjs";
import { fakeNotifier } from "../src/adapters/fake-notifier.mjs";

test("26 duplicate review/event replay is idempotent", () => {
  const event = { id: "e", payload: { value: 1 } }; assert.deepEqual(appendEvent(appendEvent([], event), event), [event]);
  const bundle = { iterations: [], summaries: [], outbox: [] }, args = { iteration: { id: "i" }, summary: { id: "s" }, event }; assert.deepEqual(commitReviewBundle(commitReviewBundle(bundle, args), args), commitReviewBundle(bundle, args));
});
test("27 conflicting event and review payloads fail", () => {
  assert.throws(() => appendEvent([{ id: "e", payload: { value: 1 } }], { id: "e", payload: { value: 2 } }), /CONFLICTING/);
  const state = { iterations: [{ id: "i", value: 1 }], summaries: [], outbox: [] }; assert.throws(() => commitReviewBundle(state, { iteration: { id: "i", value: 2 }, summary: {}, event: {} }), /CONFLICTING/);
});
test("28 notification failure preserves durable summary and event", () => {
  const event = { id: "e", payload: { summaryId: "s" } }, notifier = fakeNotifier({ fail: true }); const events = markNotification([event], event.id, notifier.send(event).status); assert.equal(events[0].notificationStatus, "FAILED"); assert.equal(events[0].payload.summaryId, "s");
});
