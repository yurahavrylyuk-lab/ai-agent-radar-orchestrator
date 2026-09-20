import { FIXED_POLICY } from "./contracts.mjs";

export function quotaDecision(quota) {
  const required = ["known", "exhausted", "remaining", "estimated", "overageProtected"];
  if (!quota || required.some((key) => !(key in quota))) return { allowed: false, reason: "UNKNOWN_QUOTA" };
  if (!quota.known) return { allowed: false, reason: "UNKNOWN_QUOTA" };
  if (quota.stale) return { allowed: false, reason: "STALE_QUOTA" };
  if (quota.exhausted) return { allowed: false, reason: "EXHAUSTED_QUOTA" };
  if (!quota.overageProtected) return { allowed: false, reason: "OVERAGE_UNPROTECTED" };
  if (quota.remaining < quota.estimated) return { allowed: false, reason: "INSUFFICIENT_QUOTA" };
  return { allowed: true, reason: "WITHIN_QUOTA" };
}
export function roleExecutionAllowed({ quota, modelAvailable = true, elapsedMs = 0, cycleActiveMs = 0 }) {
  if (!FIXED_POLICY.liveOperationsEnabled) return { allowed: false, reason: "LIVE_OPERATIONS_DISABLED" };
  if (!modelAvailable) return { allowed: false, reason: "MODEL_UNAVAILABLE_NO_FALLBACK" };
  if (elapsedMs > FIXED_POLICY.maxRoleExecutionMs || cycleActiveMs + elapsedMs > FIXED_POLICY.maxCycleActiveMs) return { allowed: false, reason: "TIME_LIMIT" };
  return quotaDecision(quota);
}
