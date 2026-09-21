import fs from "node:fs";
import path from "node:path";
import { PHASE2, sha256Canonical } from "./contracts.mjs";
import { git, resolveCommit, statusPorcelain, verifyPilotCandidate } from "./git-evidence.mjs";
import { mutateStateV2, readState } from "./local-store.mjs";
import { resolveRegisteredWorkspace } from "./workspaces.mjs";

function filesFromStatus(raw) {
  const parts = raw.split("\0").filter(Boolean); return parts.map((entry) => entry.slice(3));
}
export function createLocalCheckpoint({ statePath, ownerId, ownerGeneration, taskId, now, inject = null }) {
  const initial = readState(statePath); const task = initial.tasks.find((item) => item.taskId === taskId); if (!task || task.purpose !== "BUILDER_IMPLEMENTATION") throw new Error("BUILDER_TASK_REQUIRED");
  const existingReceipt = initial.checkpointReceipts.find((item) => item.taskId === taskId); if (existingReceipt) return { status: "IDEMPOTENT_REPLAY", receipt: structuredClone(existingReceipt) };
  if (initial.checkpointIntents.some((item) => item.taskId === taskId)) throw Object.assign(new Error("CHECKPOINT_RECONCILIATION_REQUIRED"), { code: "CHECKPOINT_RECONCILIATION_REQUIRED" });
  if (initial.humanHold) throw new Error("HUMAN_HOLD");
  const workspace = initial.workspaces.find((item) => item.taskId === taskId); const root = resolveRegisteredWorkspace(workspace, "builder");
  const cycle = initial.cycles.find((item) => item.id === task.cycleId); if (!cycle) throw new Error("CYCLE_NOT_FOUND");
  const dirty = filesFromStatus(statusPorcelain(root)); if (dirty.length !== 1 || dirty[0] !== PHASE2.pilotPath) throw new Error("CHECKPOINT_SCOPE_VIOLATION");
  const file = path.join(root, PHASE2.pilotPath); const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111)) throw new Error("CHECKPOINT_FILE_TYPE_VIOLATION");
  const expectedParent = cycle.iterationBaseCommit; if (resolveCommit(root) !== expectedParent) throw new Error("WORKSPACE_TIP_MISMATCH");
  const intent = { intentId: `checkpoint:${taskId}`, taskId, workspaceId: workspace.workspaceId, expectedParent, path: PHASE2.pilotPath, status: "PREPARED", createdAt: now };
  mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) { state.checkpointIntents.push(intent); state.humanHold = true; state.stateVersion += 1; return { state }; } });
  if (inject === "after-intent") throw Object.assign(new Error("CHECKPOINT_RECONCILIATION_REQUIRED"), { code: "CHECKPOINT_RECONCILIATION_REQUIRED" });
  try {
    git(root, ["add", "--", PHASE2.pilotPath], { write: true });
    git(root, ["-c", "user.name=GOV-002 Builder", "-c", "user.email=offline@example.invalid", "commit", "--no-gpg-sign", "-m", `GOV-002 simulated candidate iteration ${task.iteration}`], { write: true, env: { GIT_AUTHOR_DATE: now, GIT_COMMITTER_DATE: now } });
    if (inject === "after-commit") throw new Error("INJECTED_CHECKPOINT_UNCERTAINTY");
    const candidateCommit = resolveCommit(root); const evidence = verifyPilotCandidate({ root, candidateCommit, expectedParent, baselineCommit: cycle.baselineCommit, previousCandidate: task.iteration > 1 ? expectedParent : null });
    const receipt = { receiptId: `checkpoint-receipt:${taskId}`, taskId, workspaceId: workspace.workspaceId, parentCommit: expectedParent, candidateCommit, treeId: evidence.tree, scopeDigest: evidence.scopeDigest, createdAt: now };
    mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) {
      const storedIntent = state.checkpointIntents.find((item) => item.taskId === taskId); storedIntent.status = "COMPLETED"; storedIntent.candidateCommit = candidateCommit; storedIntent.digest = sha256Canonical(receipt);
      state.checkpointReceipts.push(receipt); state.humanHold = false; state.stateVersion += 1; return { state, value: receipt };
    }});
    return { status: "CREATED", receipt };
  } catch (error) {
    try { mutateStateV2({ statePath, ownerId, ownerGeneration, mutator(state) { state.humanHold = true; const storedIntent = state.checkpointIntents.find((item) => item.taskId === taskId); if (storedIntent) storedIntent.status = "RECONCILIATION_REQUIRED"; state.stateVersion += 1; return { state }; } }); } catch { /* retain the original uncertainty */ }
    if (error.code === "CHECKPOINT_RECONCILIATION_REQUIRED") throw error;
    const uncertain = new Error("CHECKPOINT_RECONCILIATION_REQUIRED", { cause: error }); uncertain.code = "CHECKPOINT_RECONCILIATION_REQUIRED"; throw uncertain;
  }
}
