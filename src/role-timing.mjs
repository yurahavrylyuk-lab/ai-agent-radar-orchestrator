import { PHASE2 } from "./contracts.mjs";
import { mutateStateV2 } from "./local-store.mjs";

function pending(state, taskId) {
  if (state.pendingTaskId !== taskId) throw new Error("TASK_NOT_PENDING");
  const task = state.tasks.find((item) => item.taskId === taskId); if (!task) throw new Error("TASK_NOT_FOUND"); return task;
}
export function startRole({ statePath, ownerId, ownerGeneration, taskId, now }) {
  return mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) {
    if (state.humanHold) throw new Error("HUMAN_HOLD");
    pending(state, taskId); const existing = state.timings.find((item) => item.taskId === taskId);
    if (existing?.status === "EXECUTING") return { unchanged: true, value: existing };
    if (existing) throw new Error("ROLE_ALREADY_FINISHED");
    const timing = { taskId, status: "EXECUTING", waitingStartedAt: state.tasks.find((item) => item.taskId === taskId).createdAt, startedAt: now, finishedAt: null, activeMs: 0, waitingMs: Math.max(0, Date.parse(now) - Date.parse(state.tasks.find((item) => item.taskId === taskId).createdAt)) };
    state.timings.push(timing); state.stateVersion += 1; return { state, value: timing };
  }});
}
export function finishRole({ statePath, ownerId, ownerGeneration, taskId, now }) {
  return mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) {
    if (state.humanHold) throw new Error("HUMAN_HOLD");
    pending(state, taskId); const timing = state.timings.find((item) => item.taskId === taskId); if (!timing || timing.status !== "EXECUTING") throw new Error("ROLE_NOT_EXECUTING");
    const activeMs = Math.max(0, Date.parse(now) - Date.parse(timing.startedAt)); timing.status = "WAITING"; timing.finishedAt = now; timing.activeMs = activeMs;
    if (activeMs > PHASE2.maxExecutionSeconds * 1000) state.humanHold = true;
    state.stateVersion += 1; return { state, value: timing };
  }});
}
