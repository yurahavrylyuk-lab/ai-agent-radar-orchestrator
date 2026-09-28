import { PHASE2 } from "./contracts.mjs";
import { mutateStateV2 } from "./local-store.mjs";

function pending(state, taskId) {
  if (state.pendingTaskId !== taskId) throw new Error("TASK_NOT_PENDING");
  const task = state.tasks.find((item) => item.taskId === taskId); if (!task) throw new Error("TASK_NOT_FOUND"); return task;
}
function dispositionAllowed(state, task) { return state.humanHold && task.purpose === "ARCHITECT_FINAL_DECISION"; }
export function activeCycleExecutionMs(state, cycleId) {
  const taskIds = new Set(state.tasks.filter((item) => item.cycleId === cycleId).map((item) => item.taskId));
  return state.timings.filter((item) => taskIds.has(item.taskId) && ["COMPLETED", "INTERRUPTED"].includes(item.status)).reduce((sum, item) => sum + item.activeMs, 0);
}
export function assertSubmissionTiming(state, task, { allowLimitExceeded = false } = {}) {
  const timing = state.timings.find((item) => item.taskId === task.taskId); if (!timing) throw new Error("ROLE_TIMING_REQUIRED");
  if (timing.status === "EXECUTING" || timing.finishedAt === null) throw new Error("ROLE_EXECUTION_STILL_OPEN");
  if (timing.status !== "COMPLETED") throw new Error("ROLE_TIMING_INCONSISTENT");
  if (!allowLimitExceeded && timing.activeMs > PHASE2.maxExecutionSeconds * 1000) throw new Error("ROLE_EXECUTION_LIMIT_EXCEEDED");
  if (!allowLimitExceeded && activeCycleExecutionMs(state, task.cycleId) > PHASE2.maxCycleExecutionSeconds * 1000) throw new Error("CYCLE_EXECUTION_LIMIT_EXCEEDED");
  return timing;
}
export function startRole({ statePath, ownerId, ownerGeneration, taskId, now }) {
  return mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) {
    const task = pending(state, taskId); if (state.humanHold && !dispositionAllowed(state, task)) throw new Error("HUMAN_HOLD");
    if (Date.parse(now) < Date.parse(task.createdAt)) throw new Error("ROLE_TIMING_INCONSISTENT");
    const existing = state.timings.find((item) => item.taskId === taskId);
    if (existing?.status === "EXECUTING") return { unchanged: true, value: existing };
    if (existing) throw new Error("ROLE_ALREADY_FINISHED");
    const timing = { taskId, status: "EXECUTING", waitingStartedAt: state.tasks.find((item) => item.taskId === taskId).createdAt, startedAt: now, finishedAt: null, activeMs: 0, waitingMs: Math.max(0, Date.parse(now) - Date.parse(state.tasks.find((item) => item.taskId === taskId).createdAt)) };
    state.timings.push(timing); state.stateVersion += 1; return { state, value: timing };
  }});
}
export function finishRole({ statePath, ownerId, ownerGeneration, taskId, now }) {
  return completeRoleTiming({ statePath, ownerId, ownerGeneration, taskId, now, activeMs: null, status: "COMPLETED" });
}
function completeRoleTiming({ statePath, ownerId, ownerGeneration, taskId, now, activeMs, status }) {
  return mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) {
    const task = pending(state, taskId); if (status !== "INTERRUPTED" && state.humanHold && !dispositionAllowed(state, task)) throw new Error("HUMAN_HOLD");
    const timing = state.timings.find((item) => item.taskId === taskId); if (!timing || timing.status !== "EXECUTING") throw new Error("ROLE_NOT_EXECUTING");
    if (Date.parse(now) < Date.parse(timing.startedAt)) throw new Error("ROLE_TIMING_INCONSISTENT");
    const measured = activeMs === null ? Date.parse(now) - Date.parse(timing.startedAt) : activeMs;
    if (!Number.isSafeInteger(measured) || measured < 0) throw new Error("ROLE_ACTIVE_TIME_INVALID");
    timing.status = status; timing.finishedAt = now; timing.activeMs = measured;
    const projectedCycleMs = activeCycleExecutionMs(state, task.cycleId);
    if (measured > PHASE2.maxExecutionSeconds * 1000 || projectedCycleMs > PHASE2.maxCycleExecutionSeconds * 1000) state.humanHold = true;
    state.stateVersion += 1; return { state, value: timing };
  }});
}
export function finishRoleMeasured({ statePath, ownerId, ownerGeneration, taskId, now, activeMs }) { return completeRoleTiming({ statePath, ownerId, ownerGeneration, taskId, now, activeMs, status: "COMPLETED" }); }
export function interruptRoleMeasured({ statePath, ownerId, ownerGeneration, taskId, now, activeMs }) { return completeRoleTiming({ statePath, ownerId, ownerGeneration, taskId, now, activeMs, status: "INTERRUPTED" }); }
