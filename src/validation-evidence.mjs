import crypto from "node:crypto";
import { canonicalJson, sha256Canonical } from "./contracts.mjs";
import { changedFiles, commitMetadata, inspectGit } from "./git-evidence.mjs";
import { OFFLINE_FIXTURE_TEMPLATE_VERSION, validateOfflineFixtureTemplate } from "./offline-fixture-content.mjs";
import { resolveRegisteredWorkspace } from "./workspaces.mjs";
import { inspectAiRadarSearch10Candidate, isAiRadarSearch10RepositoryId } from "./scenarios/ai-radar-search10.mjs";

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

const EXECUTED_RECIPE_VERSION = "offline-validation-r2";

function validationWorkspace(state, task) {
  const direct = state.workspaces.find((item) => item.taskId === task.taskId);
  if (direct) return resolveRegisteredWorkspace(direct, task.role);
  const checkpoint = checkpointFor(state, task); const source = state.workspaces.find((item) => item.workspaceId === checkpoint?.workspaceId);
  return resolveRegisteredWorkspace(source, "builder");
}

export function candidateBlob(root, candidateCommit, expectedPath, expectedObject) {
  const raw = inspectGit(root, ["ls-tree", "-z", candidateCommit, "--", expectedPath]).stdout;
  const match = raw.toString("utf8").match(/^(\d{6}) (\S+) ([0-9a-f]{40})\t([^\0]+)\0$/u);
  if (!match || match[4] !== expectedPath) throw new Error("VALIDATION_CANDIDATE_PATH_MISSING");
  const [, mode, type, objectId] = match;
  if (type !== "blob" || mode !== "100644") throw new Error("VALIDATION_CANDIDATE_FILE_TYPE_OR_MODE_INVALID");
  if (objectId !== expectedObject) throw new Error("VALIDATION_CANDIDATE_OBJECT_MISMATCH");
  const bytes = inspectGit(root, ["cat-file", "blob", objectId]).stdout;
  const verifiedObject = inspectGit(root, ["hash-object", "--stdin"], { input: bytes }).stdout.toString("utf8").trim();
  if (verifiedObject !== objectId) throw new Error("VALIDATION_CANDIDATE_OBJECT_LOOKUP_MISMATCH");
  return { bytes, mode, objectId };
}

function validateRecipe(recipeId, { cumulative, content, mode, templateValid }) {
  if (recipeId === "validate-exact-add-scope") return cumulative.length === 1 && cumulative[0].path === "docs/learning/offline-fixture-reading.md" && cumulative[0].status === "A" && cumulative[0].oldMode === "000000" && cumulative[0].newMode === "100644" && mode === "100644";
  if (recipeId === "validate-fictional-offline-content") return templateValid;
  if (recipeId === "validate-prohibited-content-absence") return templateValid && !/(?:api[_ -]?key|secret|credential|provider|cloudflare|wrangler|resend|\bd1\b|billing|deploy(?:ment)?|production|operational\s+(?:command|instruction)|network\s+request)/iu.test(content);
  throw new Error(`UNKNOWN_EXECUTED_VALIDATION_RECIPE:${recipeId}`);
}

export function inspectOfflineCandidate(root, baselineCommit, candidateCommit) {
  const metadata = commitMetadata(root, candidateCommit); const cumulative = changedFiles(root, baselineCommit, candidateCommit);
  const expected = cumulative.find((item) => item.path === "docs/learning/offline-fixture-reading.md"); if (!expected) throw new Error("VALIDATION_CANDIDATE_PATH_MISSING");
  const blob = candidateBlob(root, candidateCommit, expected.path, expected.newObject); const content = blob.bytes.toString("utf8"); const templateValid = validateOfflineFixtureTemplate(content); const blobDigest = crypto.createHash("sha256").update(blob.bytes).digest("hex");
  const outcomes = Object.freeze({ "validate-exact-add-scope": validateRecipe("validate-exact-add-scope", { cumulative, content, mode: blob.mode, templateValid }), "validate-fictional-offline-content": validateRecipe("validate-fictional-offline-content", { cumulative, content, mode: blob.mode, templateValid }), "validate-prohibited-content-absence": validateRecipe("validate-prohibited-content-absence", { cumulative, content, mode: blob.mode, templateValid }) });
  return Object.freeze({ metadata, cumulative, blob: Object.freeze({ objectId: blob.objectId, mode: blob.mode, digest: blobDigest, bytes: Buffer.from(blob.bytes) }), templateVersion: OFFLINE_FIXTURE_TEMPLATE_VERSION, outcomes });
}

export function executedValidationEntries(state, task, executionId) {
  if (state.evidenceMode !== "OFFLINE_FIXTURE" || task.evidenceMode !== "OFFLINE_FIXTURE") throw new Error("EXECUTED_VALIDATION_MODE_REQUIRED");
  const checkpoint = checkpointFor(state, task); if (!checkpoint) throw new Error("VALIDATION_EVIDENCE_NOT_READY");
  const root = validationWorkspace(state, task); const baselineCommit = state.cycles.find((item) => item.id === task.cycleId).baselineCommit;
  const search10 = isAiRadarSearch10RepositoryId(state.repositoryId);
  const candidate = search10 ? inspectAiRadarSearch10Candidate(root, baselineCommit, checkpoint.candidateCommit) : inspectOfflineCandidate(root, baselineCommit, checkpoint.candidateCommit);
  if (candidate.metadata.tree !== checkpoint.treeId) throw new Error("VALIDATION_CANDIDATE_TREE_MISMATCH");
  const identity = checkpointIdentityEvidence(state, task); const checkpointIdentityDigest = sha256Canonical(identity);
  return task.authorization.validationRequirements.map((recipe) => {
    if (!(recipe.id in candidate.outcomes)) throw new Error(`UNKNOWN_EXECUTED_VALIDATION_RECIPE:${recipe.id}`); const passed = candidate.outcomes[recipe.id];
    const primary = search10 ? candidate.objects[0] : { objectId: candidate.blob.objectId, digest: candidate.blob.digest, mode: candidate.blob.mode };
    const detailsDigest = search10 ? candidate.detailsDigest : sha256Canonical({ recipeId: recipe.id, cumulative: candidate.cumulative, blobObjectId: candidate.blob.objectId, blobDigest: candidate.blob.digest, mode: candidate.blob.mode, templateVersion: candidate.templateVersion, passed });
    const evidence = { schemaVersion: 4, evidenceType: "CONTROLLER_EXECUTED_VALIDATION", provenance: "CONTROLLER_EXECUTED", repositoryId: state.repositoryId, evidenceMode: "OFFLINE_FIXTURE", cycleId: task.cycleId, taskId: task.taskId, role: task.role, recipeId: recipe.id, baselineCommit: task.binding.baselineCommit, candidateCommit: checkpoint.candidateCommit, treeId: checkpoint.treeId, blobObjectId: primary.objectId, blobDigest: primary.sha256 ?? primary.digest, mode: primary.mode, recipeVersion: search10 ? "ai-radar-search10-validation-r1" : EXECUTED_RECIPE_VERSION, executionId, outcome: passed ? "PASS" : "FAIL", checkpointIdentityDigest, detailsDigest, ...(search10 ? { candidateObjects: candidate.objects, repositoryChecks: candidate.checks } : {}) };
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
