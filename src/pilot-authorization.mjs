import fs from "node:fs";
import path from "node:path";
import { PHASE2, parseJsonStrict, sha256Bytes, sha256Canonical } from "./contracts.mjs";
import { REAL_TARGET_ROOT } from "./coordinator.mjs";
import { inspectControllerIdentity } from "./controller-identity.mjs";
import { git, resolveCommit, statusPorcelain } from "./git-evidence.mjs";
import { initializeStateV2, mutateStateV2, readState } from "./local-store.mjs";
import { assertTrustedAuthoritySource, roleSandboxProfile, verifyDisposableConfinement } from "./operator-boundary.mjs";
import { assertSemanticIndexInvariant, captureTargetSnapshot } from "./target-snapshot.mjs";
import { validateAuthorityState, validatePilotAuthorizationGrant, validatePilotRequest } from "./validate.mjs";

export const AUTHORITY_STATE_VERSION = 1;
export const PILOT_REQUEST_SCHEMA_VERSION = 1;
export const PILOT_AUTHORIZATION_SCHEMA_VERSION = 2;
export const PILOT_BASELINE = "33a60a1f74960f9c171f5449627db1be362c6481";

export const PILOT_RESTRICTIONS = Object.freeze({
  maxWords: 800,
  required: ["fictional", "offline", "non-governance", "non-production", "non-operational"],
  prohibited: ["credentials", "secrets", "provider instructions", "deployment instructions", "billing instructions"],
});

export const PILOT_VALIDATIONS = Object.freeze([
  { id: "validate-exact-add-scope", description: "Verify the cumulative candidate diff is exactly one regular non-executable ADD at the authorized path." },
  { id: "validate-fictional-offline-content", description: "Verify the guide is at most 800 words and clearly fictional, offline, non-governance, non-production, and non-operational." },
  { id: "validate-prohibited-content-absence", description: "Verify no credentials, secrets, provider, deployment, or billing instructions are present." },
]);

export function expectedHumanApprovalStatement(request) {
  return `I explicitly authorize one HUMAN_ASSISTED GOV-002 pilot for request ${request.requestId} and cycle cycle:${request.requestId} to ADD ${PHASE2.pilotPath} with a maximum of 800 words, using included subscription capacity only and no paid fallback.`;
}

function targetRefs(root) {
  const optional = (revision) => {
    const result = git(root, ["rev-parse", "--verify", `${revision}^{commit}`], { allowFailure: true });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  return {
    head: resolveCommit(root),
    selfImprovement: optional("refs/heads/self-improvement"),
    originSelfImprovement: optional("refs/remotes/origin/self-improvement"),
    main: optional("refs/heads/main"),
    originMain: optional("refs/remotes/origin/main"),
  };
}

function validateApprovalFile(approval, request) {
  const fields = ["source", "reference", "statement"];
  if (!approval || typeof approval !== "object" || Array.isArray(approval) || Object.keys(approval).sort().join() !== fields.sort().join()) throw new Error("HUMAN_APPROVAL_FILE_INVALID");
  if (approval.source !== "HUMAN_OPERATOR" || typeof approval.reference !== "string" || approval.reference.length === 0 || approval.statement !== expectedHumanApprovalStatement(request)) throw new Error("HUMAN_APPROVAL_STATEMENT_MISMATCH");
}

function legacyApproval(grant) {
  return {
    approvalId: grant.authorizationId,
    scope: `Add only ${PHASE2.pilotPath} as the bounded fictional offline learning guide.`,
    allowedChanges: structuredClone(grant.allowedChanges),
    forbiddenChanges: grant.contentRestrictions.prohibited.map((item) => `No ${item}`),
    acceptanceCriteria: grant.contentRestrictions.required.map((item) => ({ id: `content-${item}`, description: `The guide must be ${item}.` })),
    validationRequirements: structuredClone(grant.validationRequirements),
  };
}

function initialLifecycle(grant, now) {
  return {
    authorizationId: grant.authorizationId,
    authorizationDigest: grant.authorizationDigest,
    status: "ISSUED",
    claimedRequestId: null,
    claimedCycleId: null,
    integrationIntentId: null,
    integratedCommit: null,
    transitionHistory: [{ from: null, to: "ISSUED", at: now, reason: "HUMAN_AUTHORIZATION_CONFIRMED" }],
  };
}

export function preparePilotAuthorization({ statePath, request, humanApproval, controllerRoot = process.cwd(), now = new Date().toISOString() }) {
  validatePilotRequest(request);
  validateApprovalFile(humanApproval, request);
  const canonicalTargetRoot = fs.realpathSync(request.targetRoot);
  if (canonicalTargetRoot !== path.resolve(request.targetRoot)) throw new Error("TARGET_ROOT_NOT_CANONICAL");
  const realTarget = canonicalTargetRoot === fs.realpathSync(REAL_TARGET_ROOT);
  const existing = fs.existsSync(statePath) ? readState(statePath) : null;
  if (existing !== null) validateAuthorityState(existing, statePath);
  const authority = assertTrustedAuthoritySource({ statePath, targetRoot: canonicalTargetRoot, stored: existing?.authorityStore ?? null });
  const expectedStore = { canonicalStatePath: authority.canonicalStatePath, canonicalRoot: authority.canonicalRoot, authorityStoreId: authority.authorityStoreId };
  const store = existing?.authorityStore ?? expectedStore;
  if (store.canonicalRoot === canonicalTargetRoot || store.canonicalRoot === fs.realpathSync(controllerRoot)) throw new Error("AUTHORITY_STORE_NOT_SEPARATE");
  if (existing !== null && existing.repositoryId !== request.repositoryId) throw new Error("AUTHORITY_LEDGER_REPOSITORY_MISMATCH");
  const controller = inspectControllerIdentity(controllerRoot, { requirePublished: true });
  if (request.evidenceMode !== "HUMAN_ASSISTED" || request.targetBranch !== PHASE2.pilotBranch) throw new Error("REAL_REQUEST_MODE_OR_BRANCH_INVALID");
  if (realTarget && request.baselineCommit !== PILOT_BASELINE) throw new Error("REAL_PILOT_BASELINE_MISMATCH");
  if (resolveCommit(canonicalTargetRoot) !== request.baselineCommit || statusPorcelain(canonicalTargetRoot) !== "") throw new Error("TARGET_BASELINE_OR_STATUS_MISMATCH");
  if (git(canonicalTargetRoot, ["branch", "--show-current"]).stdout.trim() !== request.targetBranch) throw new Error("TARGET_BRANCH_MISMATCH");
  if (fs.existsSync(path.join(canonicalTargetRoot, PHASE2.pilotPath))) throw new Error("PILOT_PATH_ALREADY_EXISTS");
  const snapshot = captureTargetSnapshot(canonicalTargetRoot);
  assertSemanticIndexInvariant(snapshot);
  const gitDirectoryPath = fs.realpathSync(path.resolve(canonicalTargetRoot, git(canonicalTargetRoot, ["rev-parse", "--git-dir"]).stdout.trim())); const gitDirectoryStat = fs.lstatSync(gitDirectoryPath);
  const protectedRefs = targetRefs(canonicalTargetRoot);
  if (protectedRefs.selfImprovement !== request.baselineCommit || protectedRefs.originSelfImprovement !== request.baselineCommit || protectedRefs.main === null || protectedRefs.originMain !== protectedRefs.main) throw new Error("TARGET_PROTECTED_REFS_MISMATCH");
  const requestDigest = sha256Canonical(request);
  const authorizationId = `authorization:${requestDigest.slice(0, 24)}`;
  if (existing?.authorizations.some((item) => item.grant.authorizationId === authorizationId || item.grant.requestId === request.requestId)) throw new Error("AUTHORIZATION_ALREADY_RECORDED");
  const confirmedAt = now;
  const boundary = realTarget ? verifyDisposableConfinement({ now }) : Object.freeze({
    schemaVersion: 1,
    mechanism: "DISPOSABLE_TARGET_BOUNDARY",
    policyDigest: roleSandboxProfile({ authorityRoot: store.canonicalRoot, controllerRoot: controller.canonicalRoot, targetRoot: canonicalTargetRoot, roleOutputRoot: path.join(path.dirname(store.canonicalRoot), "role-output") }).digest,
    networkDenied: true,
    authorityReadDenied: true,
    authorityWriteDenied: true,
    controllerWriteDenied: true,
    targetWriteDenied: true,
    descendantsDenied: true,
    verifiedAt: now,
  });
  const unsigned = {
    schemaVersion: PILOT_AUTHORIZATION_SCHEMA_VERSION,
    authorizationId,
    approval: { source: humanApproval.source, reference: humanApproval.reference, statement: humanApproval.statement, statementDigest: sha256Bytes(humanApproval.statement), confirmedAt },
    controller: { canonicalRoot: controller.canonicalRoot, commit: controller.commit, tree: controller.tree, approvedOrigin: controller.approvedOrigin },
    authorityStoreId: store.authorityStoreId,
    repositoryId: request.repositoryId,
    canonicalTargetRoot,
    targetBranch: request.targetBranch,
    baselineCommit: request.baselineCommit,
    targetSnapshot: { manifestDigest: snapshot.manifestDigest, modesDigest: snapshot.modesDigest, configDigest: snapshot.configDigest, rawIndexDigestDiagnostic: snapshot.rawIndexDigestDiagnostic, semanticIndex: structuredClone(snapshot.semanticIndex), fileCount: snapshot.manifest.length, gitDirectoryIdentity: { canonicalPath: gitDirectoryPath, device: gitDirectoryStat.dev, inode: gitDirectoryStat.ino }, protectedRefs },
    requestId: request.requestId,
    requestDigest,
    cycleId: `cycle:${request.requestId}`,
    evidenceMode: "HUMAN_ASSISTED",
    allowedChanges: [{ path: PHASE2.pilotPath, operation: "ADD" }],
    contentRestrictions: structuredClone(PILOT_RESTRICTIONS),
    validationRequirements: structuredClone(PILOT_VALIDATIONS),
    maxRuntimeIterations: 3,
    maxSuccessfulIntegrations: 1,
    issuedAt: now,
  };
  const grant = { ...unsigned, authorizationDigest: sha256Canonical(unsigned) };
  validatePilotAuthorizationGrant(grant);
  return Object.freeze({ grant: structuredClone(grant), request: structuredClone(request), store: structuredClone(store), boundary: structuredClone(boundary) });
}

export function commitPilotAuthorization({ statePath, proposal, confirmation }) {
  if (confirmation !== `CONFIRM ${proposal.grant.authorizationDigest}`) throw new Error("DIGEST_SPECIFIC_CONFIRMATION_REQUIRED");
  const grant = proposal.grant;
  assertTrustedAuthoritySource({ statePath, targetRoot: grant.canonicalTargetRoot, stored: { ...proposal.store, boundary: proposal.boundary } });
  const state = {
    schemaVersion: 3,
    authorityStateVersion: AUTHORITY_STATE_VERSION,
    controllerId: "gov-002-real-pilot-controller",
    repositoryId: grant.repositoryId,
    evidenceMode: "HUMAN_ASSISTED",
    stateVersion: 0,
    owner: { id: "trusted-operator", generation: 1 },
    queue: [], activeCycleId: null, humanHold: false,
    approval: legacyApproval(grant),
    capabilities: { realPilotActivation: true, liveProviders: false, network: false, publication: false, scheduling: false },
    cycles: [], plans: [], tasks: [], pendingTaskId: null, results: [], receipts: [], iterations: [], reviews: [], summaries: [], outbox: [], workspaces: [], timings: [], checkpointIntents: [], checkpointReceipts: [], integrationIntents: [], integrationOutcomes: [], migration: null,
    authorityStore: { ...proposal.store, boundary: proposal.boundary },
    authorizations: [{ grant: structuredClone(grant), lifecycle: initialLifecycle(grant, grant.issuedAt) }],
    admissionReceipts: [],
  };
  if (fs.existsSync(statePath)) {
    const existing = readState(statePath); validateAuthorityState(existing, statePath); assertTrustedAuthoritySource({ statePath, targetRoot: grant.canonicalTargetRoot, stored: existing.authorityStore });
    if (existing.repositoryId !== grant.repositoryId || existing.authorizations.some((item) => item.grant.authorizationId === grant.authorizationId || item.grant.requestId === grant.requestId)) throw new Error("AUTHORIZATION_LEDGER_CONFLICT");
    mutateStateV2({ statePath, ownerId: existing.owner.id, ownerGeneration: existing.owner.generation, mutator(current) { current.authorizations.push({ grant: structuredClone(grant), lifecycle: initialLifecycle(grant, grant.issuedAt) }); current.stateVersion += 1; return { state: current }; } });
  } else {
    validateAuthorityState(state, statePath);
    initializeStateV2(statePath, state);
  }
  return { status: "ISSUED", authorizationId: grant.authorizationId, authorizationDigest: grant.authorizationDigest, statePath: proposal.store.canonicalStatePath };
}

export function showPilotAuthorization(statePath, authorizationId) {
  const state = readState(statePath);
  validateAuthorityState(state, statePath);
  const record = state.authorizations.find((item) => item.grant.authorizationId === authorizationId);
  if (!record) throw new Error("AUTHORIZATION_NOT_FOUND");
  assertTrustedAuthoritySource({ statePath, targetRoot: record.grant.canonicalTargetRoot, stored: state.authorityStore });
  return structuredClone(record);
}

export function readApprovalFile(filePath) {
  return parseJsonStrict(fs.readFileSync(filePath, "utf8"));
}
