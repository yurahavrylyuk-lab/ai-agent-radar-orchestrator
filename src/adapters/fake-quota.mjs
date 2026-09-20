export function fakeQuota(overrides = {}) {
  return { known: true, stale: false, exhausted: false, remaining: 100, estimated: 1, overageProtected: true, ...overrides };
}
