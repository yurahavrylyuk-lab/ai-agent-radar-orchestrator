export function fakeNotifier({ fail = false } = {}) {
  let calls = 0;
  return { send(event) { calls += 1; return fail ? { status: "FAILED", eventId: event.id, simulated: true } : { status: "SENT", eventId: event.id, simulated: true }; }, calls: () => calls };
}
