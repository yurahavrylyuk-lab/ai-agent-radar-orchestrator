import { canonicalJson, sha256Canonical } from "./contracts.mjs";

const VALIDATED_PURPOSES = new Set(["BUILDER_IMPLEMENTATION", "ANALYST_REVIEW"]);
const ATTESTED_OUTCOMES = new Set(["PASS", "FAIL"]);

function checkpointFor(state, task) {
  if (task.purpose === "BUILDER_IMPLEMENTATION") return state.checkpointReceipts.find((item) => item.taskId === task.taskId) ?? null;
  const iteration = state.iterations.find((item) => item.cycleId === task.cycleId && item.index === task.iteration);
  if (!iteration || iteration.candidateCommit !== task.binding.reviewedCommit) return null;
  return state.checkpointReceipts.find((item) => item.receiptId === iteration.checkpointReceiptId) ?? null;
}

function candidateFor(task, checkpoint) {
  const candidateCommit = task.purpose === "BUILDER_IMPLEMENTATION" ? checkpoint.candidateCommit : task.binding.reviewedCommit;
  if (checkpoint.candidateCommit !== candidateCommit) throw new Error("VALIDATION_EVIDENCE_CANDIDATE_MISMATCH");
  return candidateCommit;
}

export function checkpointIdentityEvidence(state, task) {
  if (!VALIDATED_PURPOSES.has(task.purpose)) return null;
  if (state.repositoryId !== task.repositoryId) throw new Error("VALIDATION_EVIDENCE_REPOSITORY_MISMATCH");
  const checkpoint = checkpointFor(state, task); if (!checkpoint) return null;
  return {
    schemaVersion: 2,
    evidenceType: "CHECKPOINT_IDENTITY",
    provenance: "CONTROLLER_VERIFIED",
    repositoryId: state.repositoryId,
    evidenceMode: state.evidenceMode,
    cycleId: task.cycleId,
    taskId: task.taskId,
    role: task.role,
    candidateCommit: candidateFor(task, checkpoint),
    checkpointReceiptId: checkpoint.receiptId,
    checkpointDigest: sha256Canonical(checkpoint),
    treeId: checkpoint.treeId,
    scopeDigest: checkpoint.scopeDigest,
  };
}

function attestationRecord(state, task, recipeId, outcome, identityEvidence, identityDigest) {
  if (!ATTESTED_OUTCOMES.has(outcome)) throw new Error("VALIDATION_ATTESTATION_OUTCOME_INVALID");
  return {
    schemaVersion: 2,
    evidenceType: "ROLE_VALIDATION_ATTESTATION",
    provenance: "HUMAN_ATTESTED",
    repositoryId: state.repositoryId,
    evidenceMode: state.evidenceMode,
    cycleId: task.cycleId,
    taskId: task.taskId,
    role: task.role,
    recipeId,
    candidateCommit: identityEvidence.candidateCommit,
    outcome,
    checkpointIdentityDigest: identityDigest,
  };
}

function attestationEntry(state, task, recipeId, outcome, identityEvidence, identityDigest) {
  const evidence = attestationRecord(state, task, recipeId, outcome, identityEvidence, identityDigest);
  return { recipeId, outcome, evidence, evidenceDigest: sha256Canonical(evidence), skipReason: null };
}

export function requiredValidationEvidence(state, task, { allowPending = false } = {}) {
  if (!VALIDATED_PURPOSES.has(task.purpose)) return [];
  if (state.repositoryId !== task.repositoryId) throw new Error("VALIDATION_EVIDENCE_REPOSITORY_MISMATCH");
  const identityEvidence = checkpointIdentityEvidence(state, task);
  if (!identityEvidence) {
    if (allowPending) return task.authorization.validationRequirements.map((recipe) => ({ recipeId: recipe.id, description: recipe.description, status: "PENDING_CHECKPOINT", identityEvidence: null, identityEvidenceDigest: null, attestationOptions: null }));
    throw new Error("VALIDATION_EVIDENCE_NOT_READY");
  }
  const identityEvidenceDigest = sha256Canonical(identityEvidence);
  return task.authorization.validationRequirements.map((recipe) => ({
    recipeId: recipe.id,
    description: recipe.description,
    status: "AWAITING_ATTESTATION",
    identityEvidence,
    identityEvidenceDigest,
    attestationOptions: {
      PASS: attestationEntry(state, task, recipe.id, "PASS", identityEvidence, identityEvidenceDigest),
      FAIL: attestationEntry(state, task, recipe.id, "FAIL", identityEvidence, identityEvidenceDigest),
    },
  }));
}

export function expectedValidationEntries(state, task, { allowPending = false } = {}) {
  return requiredValidationEvidence(state, task, { allowPending }).map((item) => ({ recipeId: item.recipeId, outcome: null, evidence: null, evidenceDigest: null, skipReason: null }));
}

export function attestedValidationEntries(state, task, outcome) {
  if (!ATTESTED_OUTCOMES.has(outcome)) throw new Error("VALIDATION_ATTESTATION_OUTCOME_INVALID");
  return requiredValidationEvidence(state, task).map((item) => structuredClone(item.attestationOptions[outcome]));
}

function requiresAllPass(task, result) {
  if (task.purpose === "BUILDER_IMPLEMENTATION") return true;
  return ["PASS", "PASS_WITH_RECOMMENDATIONS"].includes(result.payload.reviewState);
}

export function validateRequiredValidationEvidence(state, task, result) {
  if (result.outcome !== "COMPLETED" || !VALIDATED_PURPOSES.has(task.purpose)) return true;
  const submitted = result.payload.validation;
  const required = task.authorization.validationRequirements.map((item) => item.id);
  if (!Array.isArray(submitted) || submitted.length !== required.length) throw new Error("REQUIRED_VALIDATION_SET_INCOMPLETE");
  if (new Set(submitted.map((item) => item.recipeId)).size !== submitted.length) throw new Error("DUPLICATE_VALIDATION_RECIPE");
  const expected = new Map(requiredValidationEvidence(state, task).map((item) => [item.recipeId, item]));
  for (const entry of submitted) {
    const requirement = expected.get(entry.recipeId); if (!requirement) throw new Error("UNKNOWN_VALIDATION_RECIPE");
    if (!ATTESTED_OUTCOMES.has(entry.outcome) || entry.skipReason !== null || !entry.evidence) throw new Error("REQUIRED_VALIDATION_NOT_PERFORMED");
    if (entry.evidenceDigest !== sha256Canonical(entry.evidence)) throw new Error("VALIDATION_EVIDENCE_DIGEST_MISMATCH");
    const expectedEntry = requirement.attestationOptions[entry.outcome];
    if (canonicalJson(entry) !== canonicalJson(expectedEntry)) throw new Error("VALIDATION_EVIDENCE_UNRESOLVABLE");
    if (requiresAllPass(task, result) && entry.outcome !== "PASS") throw new Error("REQUIRED_VALIDATION_DID_NOT_PASS");
  }
  return true;
}
