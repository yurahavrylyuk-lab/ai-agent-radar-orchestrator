import { immutable } from "./contracts.mjs";
import { validateCycle } from "./validate.mjs";

const allowed = Object.freeze({
  QUEUED: ["ACTIVE", "HALTED"],
  ACTIVE: ["AWAITING_HUMAN_ROLE", "REVIEW", "HALTED"],
  AWAITING_HUMAN_ROLE: ["ACTIVE", "HALTED"],
  REVIEW: ["ACTIVE", "ACCEPTED", "REJECTED", "ESCALATED", "HALTED"],
  ACCEPTED: [], REJECTED: [], ESCALATED: [], HALTED: [],
});

export function transitionCycle(cycle, next) {
  validateCycle(cycle);
  if (!allowed[cycle.status]?.includes(next)) throw new Error(`Illegal transition ${cycle.status} -> ${next}`);
  return immutable({ ...cycle, status: next });
}

export function nextReviewIteration(cycle, reviewState) {
  validateCycle(cycle);
  if (cycle.iterationIds.length >= 3 && !["PASS", "PASS_WITH_RECOMMENDATIONS"].includes(reviewState)) return immutable({ ...cycle, status: "ESCALATED" });
  return immutable(cycle);
}

export function validateReviewTarget(expected, review) {
  for (const key of ["cycleId", "planRevision", "builderCommit"]) {
    if (expected[key] !== review[key]) throw new Error(`REVIEW_${key.toUpperCase()}_MISMATCH`);
  }
  return true;
}

export function uncertainCompletion() {
  return Object.freeze({ status: "HALTED", reason: "UNCERTAIN_AI_COMPLETION", replay: false });
}

export function accountTime(cycle, { activeMs = 0, humanWaitingMs = 0 }) {
  const updated = { ...structuredClone(cycle), activeMs: cycle.activeMs + activeMs, humanWaitingMs: cycle.humanWaitingMs + humanWaitingMs };
  if (updated.activeMs > 90 * 60 * 1000) return Object.freeze({ ...updated, status: "HALTED" });
  return Object.freeze(updated);
}
