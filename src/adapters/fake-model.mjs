export function fakeModel({ available = true, outcome = "SIMULATED_OK" } = {}) {
  let calls = 0;
  return { invoke() { calls += 1; if (!available) return { status: "MODEL_UNAVAILABLE", fallback: false }; return { status: outcome, simulated: true }; }, calls: () => calls };
}
