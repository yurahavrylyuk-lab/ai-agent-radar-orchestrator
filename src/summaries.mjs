import { TERMINAL_CYCLE_STATES, immutable } from "./contracts.mjs";
import { validateSummary } from "./validate.mjs";

export function createIterationSummary(iteration, now) {
  return immutable({ cycleId: iteration.cycleId, status: iteration.reviewState === "PASS" ? "ACCEPTED" : iteration.reviewState === "REJECT" ? "REJECTED" : "REVIEW", iterationCount: iteration.index, message: `SIMULATED review ${iteration.reviewState}`, createdAt: now, simulated: true });
}
export function createTerminalSummary(cycle, now) {
  if (!TERMINAL_CYCLE_STATES.includes(cycle.status)) throw new Error("CYCLE_NOT_TERMINAL");
  const summary = { cycleId: cycle.id, status: cycle.status, iterationCount: cycle.iterationIds.length, message: `SIMULATED cycle ${cycle.status.toLowerCase()}`, createdAt: now, simulated: true };
  validateSummary(summary); return immutable(summary);
}
export function exportAudit(summaries, events) {
  return immutable({ summaries: structuredClone(summaries), events: structuredClone(events) });
}
