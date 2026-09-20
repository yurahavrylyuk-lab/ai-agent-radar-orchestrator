export const PLAN_STATES = Object.freeze(["EMPTY", "READY", "IN_PROGRESS", "REVIEW", "COMPLETE", "BLOCKED"]);
export const REVIEW_STATES = Object.freeze(["NOT_STARTED", "IN_REVIEW", "PASS", "PASS_WITH_RECOMMENDATIONS", "REVISE", "REJECT", "HUMAN_REVIEW_REQUIRED"]);
export const CYCLE_STATES = Object.freeze(["QUEUED", "ACTIVE", "AWAITING_HUMAN_ROLE", "REVIEW", "ACCEPTED", "REJECTED", "ESCALATED", "HALTED"]);
export const TERMINAL_CYCLE_STATES = Object.freeze(["ACCEPTED", "REJECTED", "ESCALATED", "HALTED"]);
export const ROLE_MODELS = Object.freeze({ architect: "Astra High", builder: "Sol Medium", analyst: "Terra High" });
export const FIXED_POLICY = Object.freeze({
  zeroAdditionalPaidSpend: true,
  liveOperationsEnabled: false,
  schedulingEnabled: false,
  schedule: "0 8 * * 1,3,5",
  modelFallback: false,
  maxIterations: 3,
  maxRoleExecutionMs: 15 * 60 * 1000,
  maxCycleActiveMs: 90 * 60 * 1000,
  maxActiveCycles: 1,
  authoritativeControllers: 1,
});

export function immutable(value) {
  return Object.freeze(structuredClone(value));
}
