import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendEvent, markNotification } from "../src/outbox.mjs";
import { commitReviewBundle, persistReviewBundle, replaceStateAtomic } from "../src/local-store.mjs";
import { fakeNotifier } from "../src/adapters/fake-notifier.mjs";

const iteration = (overrides = {}) => ({ id: "i1", cycleId: "c1", index: 1, planRevision: 4, builderCommit: "abc", reviewState: "PASS", createdAt: "2026-09-21T00:00:00Z", ...overrides });
const summary = (overrides = {}) => ({ cycleId: "c1", status: "ACCEPTED", iterationCount: 1, message: "SIMULATED accepted", createdAt: "2026-09-21T00:00:00Z", simulated: true, ...overrides });
const event = (overrides = {}) => ({ id: "e1", payload: { iterationId: "i1", value: 1 }, ...overrides });
const emptyState = () => ({ stateVersion: 0, iterations: [], summaries: [], outbox: [] });

test("26 duplicate review/event replay is idempotent", () => {
  const original = event({ payload: { b: 2, a: 1 } }), reordered = event({ payload: { a: 1, b: 2 } }); assert.deepEqual(appendEvent(appendEvent([], original), reordered), [original]);
  const args = { iteration: iteration(), summary: summary(), event: event() }, committed = commitReviewBundle(emptyState(), args); assert.deepEqual(commitReviewBundle(committed, args), committed);
});
test("27 conflicting event and review payloads fail", () => {
  assert.throws(() => appendEvent([{ id: "e", payload: { value: 1 } }], { id: "e", payload: { value: 2 } }), /CONFLICTING/);
  const committed = commitReviewBundle(emptyState(), { iteration: iteration(), summary: summary(), event: event() });
  assert.throws(() => commitReviewBundle(committed, { iteration: iteration({ builderCommit: "changed" }), summary: summary(), event: event() }), /CONFLICTING_REVIEW/);
  assert.throws(() => commitReviewBundle(committed, { iteration: iteration(), summary: summary({ message: "changed" }), event: event() }), /CONFLICTING_SUMMARY/);
  assert.throws(() => commitReviewBundle(committed, { iteration: iteration(), summary: summary(), event: event({ payload: { value: 2 } }) }), /CONFLICTING_EVENT/);
});
test("40 review bundle routes new and existing reviews through authoritative event validation", () => {
  const conflictingOutbox = { ...emptyState(), outbox: [event({ payload: { value: "existing" } })] };
  assert.throws(() => commitReviewBundle(conflictingOutbox, { iteration: iteration(), summary: summary(), event: event({ payload: { value: "new" } }) }), /CONFLICTING_EVENT/);
  assert.throws(() => appendEvent([event(), event({ payload: { changed: true } })], event()), /CONFLICTING_EXISTING_EVENT/);
  assert.throws(() => appendEvent([event(), event()], event()), /DUPLICATE_EXISTING_EVENT/);
  assert.throws(() => appendEvent([event({ payloadHash: "caller-claim" })], event({ payloadHash: "caller-claim", payload: { changed: true } })), /CONFLICTING_EVENT/);
  const committed = commitReviewBundle(emptyState(), { iteration: iteration(), summary: summary(), event: event({ notificationStatus: "FAILED" }) });
  const duplicate = commitReviewBundle(committed, { iteration: iteration(), summary: summary(), event: event({ notificationStatus: "PENDING" }) });
  assert.equal(duplicate.outbox[0].notificationStatus, "FAILED"); assert.equal(duplicate.stateVersion, committed.stateVersion);
});
test("41 conflicting persisted review bundle leaves bytes and version unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov002-review-")), file = path.join(dir, "reviews.json"), args = { iteration: iteration(), summary: summary(), event: event() };
  replaceStateAtomic(file, emptyState()); persistReviewBundle(file, args); const before = fs.readFileSync(file); const version = JSON.parse(before).stateVersion;
  assert.throws(() => persistReviewBundle(file, { ...args, event: event({ payload: { changed: true } }) }), /CONFLICTING_EVENT/);
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(JSON.parse(fs.readFileSync(file)).stateVersion, version); fs.rmSync(dir, { recursive: true });
});
test("42 persisted review path rejects iteration four even with inconsistent short state", () => {
  const records = [1, 2, 3].reduce((state, index) => commitReviewBundle(state, { iteration: iteration({ id: `i${index}`, index }), summary: summary({ iterationCount: index, status: "REVIEW" }), event: event({ id: `e${index}`, payload: { index } }) }), emptyState());
  assert.throws(() => commitReviewBundle(records, { iteration: iteration({ id: "i4", index: 4 }), summary: summary({ iterationCount: 4 }), event: event({ id: "e4" }) }), /<= 3/);
});
test("28 notification failure preserves durable summary and event", () => {
  const event = { id: "e", payload: { summaryId: "s" } }, notifier = fakeNotifier({ fail: true }); const events = markNotification([event], event.id, notifier.send(event).status); assert.equal(events[0].notificationStatus, "FAILED"); assert.equal(events[0].payload.summaryId, "s");
});
