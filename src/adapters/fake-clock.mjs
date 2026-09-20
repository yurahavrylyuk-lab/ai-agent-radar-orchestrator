export function fakeClock(initial = "2026-09-20T00:00:00.000Z") {
  let current = Date.parse(initial);
  return { now: () => new Date(current).toISOString(), advance: (ms) => { current += ms; return new Date(current).toISOString(); } };
}
