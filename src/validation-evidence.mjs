import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Canonical } from "./contracts.mjs";
import { changedFiles, commitMetadata } from "./git-evidence.mjs";
import { resolveRegisteredWorkspace } from "./workspaces.mjs";

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
  if (task.purpose === "BUILDER_IMPLEMENTATION") return task.evidenceMode !== "OFFLINE_FIXTURE";
  return ["PASS", "PASS_WITH_RECOMMENDATIONS"].includes(result.payload.reviewState);
}

const EXECUTED_RECIPE_VERSION = "offline-validation-r1";

function validationWorkspace(state, task) {
  const direct = state.workspaces.find((item) => item.taskId === task.taskId);
  if (direct) return resolveRegisteredWorkspace(direct, task.role);
  const checkpoint = checkpointFor(state, task); const source = state.workspaces.find((item) => item.workspaceId === checkpoint?.workspaceId);
  return resolveRegisteredWorkspace(source, "builder");
}

function validateRecipe(recipeId, { cumulative, content, mode }) {
  if (recipeId === "validate-exact-add-scope") return cumulative.length === 1 && cumulative[0].path === "docs/learning/offline-fixture-reading.md" && cumulative[0].status === "A" && cumulative[0].oldMode === "000000" && cumulative[0].newMode === "100644" && mode === "100644";
  if (recipeId === "validate-fictional-offline-content") {
    const words = content.trim().split(/\s+/u).filter(Boolean).length;
    return words <= 800 && /fictional/iu.test(content) && /offline/iu.test(content) && /educational/iu.test(content);
  }
  if (recipeId === "validate-prohibited-content-absence") return !/(?:api[_ -]?key|secret|credential|cloudflare|wrangler|resend|\bd1\b|billing|deploy(?:ment)?|production command)/iu.test(content);
  throw new Error(`UNKNOWN_EXECUTED_VALIDATION_RECIPE:${recipeId}`);
}

export function executedValidationEntries(state, task, executionId) {
  if (state.evidenceMode !== "OFFLINE_FIXTURE" || task.evidenceMode !== "OFFLINE_FIXTURE") throw new Error("EXECUTED_VALIDATION_MODE_REQUIRED");
  const checkpoint = checkpointFor(state, task); if (!checkpoint) throw new Error("VALIDATION_EVIDENCE_NOT_READY");
  const root = validationWorkspace(state, task); const metadata = commitMetadata(root, checkpoint.candidateCommit);
  if (metadata.tree !== checkpoint.treeId) throw new Error("VALIDATION_CANDIDATE_TREE_MISMATCH");
  const file = path.join(root, "docs/learning/offline-fixture-reading.md"); const bytes = fs.readFileSync(file); const content = bytes.toString("utf8"); const stat = fs.lstatSync(file);
  const cumulative = changedFiles(root, state.cycles.find((item) => item.id === task.cycleId).baselineCommit, checkpoint.candidateCommit);
  const identity = checkpointIdentityEvidence(state, task); const checkpointIdentityDigest = sha256Canonical(identity); const blobDigest = crypto.createHash("sha256").update(bytes).digest("hex"); const mode = (stat.mode & 0o111) === 0 ? "100644" : "100755";
  return task.authorization.validationRequirements.map((recipe) => {
    const passed = validateRecipe(recipe.id, { cumulative, content, mode }); const detailsDigest = sha256Canonical({ recipeId: recipe.id, cumulative, blobDigest, mode, passed });
    const evidence = { schemaVersion: 3, evidenceType: "CONTROLLER_EXECUTED_VALIDATION", provenance: "CONTROLLER_EXECUTED", repositoryId: state.repositoryId, evidenceMode: "OFFLINE_FIXTURE", cycleId: task.cycleId, taskId: task.taskId, role: task.role, recipeId: recipe.id, baselineCommit: task.binding.baselineCommit, candidateCommit: checkpoint.candidateCommit, treeId: checkpoint.treeId, blobDigest, recipeVersion: EXECUTED_RECIPE_VERSION, executionId, outcome: passed ? "PASS" : "FAIL", checkpointIdentityDigest, detailsDigest };
    return { recipeId: recipe.id, outcome: evidence.outcome, evidence, evidenceDigest: sha256Canonical(evidence), skipReason: null };
  });
}

export function validateRequiredValidationEvidence(state, task, result) {
  if (result.outcome !== "COMPLETED" || !VALIDATED_PURPOSES.has(task.purpose)) return true;
  const submitted = result.payload.validation;
  const required = task.authorization.validationRequirements.map((item) => item.id);
  if (!Array.isArray(submitted) || submitted.length !== required.length) throw new Error("REQUIRED_VALIDATION_SET_INCOMPLETE");
  if (new Set(submitted.map((item) => item.recipeId)).size !== submitted.length) throw new Error("DUPLICATE_VALIDATION_RECIPE");
  if (state.evidenceMode === "OFFLINE_FIXTURE") {
    for (const entry of submitted) {
      if (entry?.evidence?.provenance !== "CONTROLLER_EXECUTED" || entry.evidence.evidenceMode !== "OFFLINE_FIXTURE") throw new Error("OFFLINE_EXECUTED_VALIDATION_REQUIRED");
      const expectedEntry = executedValidationEntries(state, task, entry.evidence.executionId).find((item) => item.recipeId === entry.recipeId);
      if (!expectedEntry || canonicalJson(entry) !== canonicalJson(expectedEntry)) throw new Error("VALIDATION_EVIDENCE_UNRESOLVABLE");
      if (requiresAllPass(task, result) && entry.outcome !== "PASS") throw new Error("REQUIRED_VALIDATION_DID_NOT_PASS");
    }
    return true;
  }
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
