import { sha256Canonical } from "./contracts.mjs";

const VALIDATED_PURPOSES = new Set(["BUILDER_IMPLEMENTATION", "ANALYST_REVIEW"]);

function checkpointFor(state, task) {
  if (task.purpose === "BUILDER_IMPLEMENTATION") {
    return state.checkpointReceipts.find((item) => item.taskId === task.taskId) ?? null;
  }
  const iteration = state.iterations.find((item) => item.cycleId === task.cycleId && item.index === task.iteration);
  if (!iteration || iteration.candidateCommit !== task.binding.reviewedCommit) return null;
  return state.checkpointReceipts.find((item) => item.receiptId === iteration.checkpointReceiptId) ?? null;
}

function evidenceRecord(state, task, recipe, checkpoint) {
  const candidateCommit = task.purpose === "BUILDER_IMPLEMENTATION" ? checkpoint.candidateCommit : task.binding.reviewedCommit;
  if (checkpoint.candidateCommit !== candidateCommit) throw new Error("VALIDATION_EVIDENCE_CANDIDATE_MISMATCH");
  return {
    schemaVersion: 2,
    repositoryId: state.repositoryId,
    cycleId: task.cycleId,
    taskId: task.taskId,
    purpose: task.purpose,
    recipeId: recipe.id,
    candidateCommit,
    checkpointReceiptId: checkpoint.receiptId,
    checkpointDigest: sha256Canonical(checkpoint),
    treeId: checkpoint.treeId,
    scopeDigest: checkpoint.scopeDigest,
  };
}

export function requiredValidationEvidence(state, task, { allowPending = false } = {}) {
  if (!VALIDATED_PURPOSES.has(task.purpose)) return [];
  if (state.repositoryId !== task.repositoryId) throw new Error("VALIDATION_EVIDENCE_REPOSITORY_MISMATCH");
  const checkpoint = checkpointFor(state, task);
  if (!checkpoint) {
    if (allowPending) return task.authorization.validationRequirements.map((recipe) => ({ recipeId: recipe.id, description: recipe.description, status: "PENDING_CHECKPOINT", record: null, evidenceDigest: null }));
    throw new Error("VALIDATION_EVIDENCE_NOT_READY");
  }
  return task.authorization.validationRequirements.map((recipe) => {
    const record = evidenceRecord(state, task, recipe, checkpoint);
    return { recipeId: recipe.id, description: recipe.description, status: "READY", record, evidenceDigest: sha256Canonical(record) };
  });
}

export function expectedValidationEntries(state, task, options = {}) {
  return requiredValidationEvidence(state, task, options).map((item) => ({ recipeId: item.recipeId, outcome: item.status === "READY" ? "PASS" : null, evidenceDigest: item.evidenceDigest, skipReason: null }));
}

export function validateRequiredValidationEvidence(state, task, result) {
  if (result.outcome !== "COMPLETED" || !VALIDATED_PURPOSES.has(task.purpose)) return true;
  const submitted = result.payload.validation;
  const required = task.authorization.validationRequirements.map((item) => item.id);
  if (!Array.isArray(submitted) || submitted.length !== required.length) throw new Error("REQUIRED_VALIDATION_SET_INCOMPLETE");
  if (new Set(submitted.map((item) => item.recipeId)).size !== submitted.length) throw new Error("DUPLICATE_VALIDATION_RECIPE");
  const expected = new Map(expectedValidationEntries(state, task).map((item) => [item.recipeId, item]));
  for (const entry of submitted) {
    const requiredEntry = expected.get(entry.recipeId);
    if (!requiredEntry) throw new Error("UNKNOWN_VALIDATION_RECIPE");
    if (entry.outcome !== "PASS" || entry.skipReason !== null) throw new Error("REQUIRED_VALIDATION_DID_NOT_PASS");
    if (entry.evidenceDigest !== requiredEntry.evidenceDigest) throw new Error("VALIDATION_EVIDENCE_UNRESOLVABLE");
  }
  return true;
}
