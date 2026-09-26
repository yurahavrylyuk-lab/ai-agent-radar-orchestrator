import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256Canonical } from "./contracts.mjs";

export const PRODUCTION_AUTHORITY_ROOT = "/Users/yuriy/Library/Application Support/AI Agent Radar Orchestrator/authority";
export const PRODUCTION_CONTROLLER_ROOT = "/Users/yuriy/Documents/IT Study/General/General/AI Agents/ai-agent-radar-orchestrator";
export const PROTECTED_REAL_TARGET_ROOT = "/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent";
export const DISPOSABLE_AUTHORITY_TEST_FLAG = "GOV002_TEST_DISPOSABLE_AUTHORITY";

const FILE_PROBES = Object.freeze([
  ["authority-read", "authorityRoot", "DENIED"], ["authority-write", "authorityRoot", "DENIED"],
  ["controller-write", "controllerRoot", "DENIED"], ["target-write", "targetRoot", "DENIED"],
  ["role-output-write", "roleOutputRoot", "ALLOWED"],
  ["descendant-authority-read", "authorityRoot", "DENIED"], ["descendant-authority-write", "authorityRoot", "DENIED"],
  ["descendant-controller-write", "controllerRoot", "DENIED"], ["descendant-target-write", "targetRoot", "DENIED"],
]);
const NETWORK_PROBES = Object.freeze(["network-inbound", "network-outbound"]);

function canonicalParent(filePath) {
  const parent = fs.realpathSync(path.dirname(path.resolve(filePath)));
  if (path.resolve(parent, path.basename(filePath)) !== path.resolve(filePath)) throw new Error("AUTHORITY_STATE_PATH_NOT_CANONICAL");
  const stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("AUTHORITY_PARENT_UNSAFE");
  return { parent, stat };
}

export function authorityStoreIdentity(statePath) {
  const { parent, stat } = canonicalParent(statePath);
  const canonicalStatePath = path.join(parent, path.basename(statePath));
  if (fs.existsSync(canonicalStatePath)) {
    const stateStat = fs.lstatSync(canonicalStatePath);
    if (!stateStat.isFile() || stateStat.isSymbolicLink()) throw new Error("AUTHORITY_STATE_FILE_UNSAFE");
    if ((stateStat.mode & 0o777) !== 0o600) throw new Error("AUTHORITY_STATE_FILE_MODE_INVALID");
  }
  const authorityStoreId = sha256Canonical({ canonicalStatePath, parentDevice: stat.dev, parentInode: stat.ino });
  return Object.freeze({ canonicalStatePath, canonicalRoot: parent, authorityStoreId });
}

function quote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function hasTraversal(rawRoot) {
  if (!path.isAbsolute(rawRoot) || rawRoot !== path.normalize(rawRoot)) return true;
  return rawRoot.split(path.sep).some((part) => part === "." || part === "..");
}

function knownMacVarAlias(rawRoot, canonicalRoot) {
  return (rawRoot === "/var" || rawRoot.startsWith("/var/")) && canonicalRoot === `/private${rawRoot}`;
}

function sameIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino; }

function identityRecord(rawRoot, canonicalRoot, stat, exists = true) {
  return Object.freeze({ rawRoot, canonicalRoot, exists, type: exists ? (stat.isDirectory() ? "directory" : "other") : "absent", device: exists ? stat.dev : null, inode: exists ? stat.ino : null, ownerUid: exists ? stat.uid : null, mode: exists ? (stat.mode & 0o7777).toString(8).padStart(4, "0") : null });
}

export function captureBoundaryRoot(rawRoot, { name = "boundaryRoot", allowMissingLeaf = false, expectedCanonicalRoot = null } = {}) {
  if (typeof rawRoot !== "string" || rawRoot.length === 0 || hasTraversal(rawRoot)) throw new Error(`${name.toUpperCase()}_PATH_TRAVERSAL_OR_NONCANONICAL`);
  const resolved = path.resolve(rawRoot);
  if (!fs.existsSync(resolved)) {
    if (!allowMissingLeaf) throw new Error(`${name.toUpperCase()}_MISSING`);
    const parent = captureBoundaryRoot(path.dirname(resolved), { name: `${name}Parent` });
    const canonicalRoot = path.join(parent.canonicalRoot, path.basename(resolved));
    if (expectedCanonicalRoot !== null && canonicalRoot !== expectedCanonicalRoot) throw new Error(`${name.toUpperCase()}_CANONICAL_MISMATCH`);
    return identityRecord(resolved, canonicalRoot, null, false);
  }
  const leaf = fs.lstatSync(resolved);
  if (leaf.isSymbolicLink()) throw new Error(`${name.toUpperCase()}_SYMLINK_LEAF`);
  if (!leaf.isDirectory()) throw new Error(`${name.toUpperCase()}_NOT_DIRECTORY`);
  const canonicalRoot = fs.realpathSync(resolved);
  const canonicalStat = fs.lstatSync(canonicalRoot); const followedStat = fs.statSync(resolved);
  if (!canonicalStat.isDirectory() || !sameIdentity(canonicalStat, followedStat)) throw new Error(`${name.toUpperCase()}_IDENTITY_MISMATCH`);
  if (resolved !== canonicalRoot && !knownMacVarAlias(resolved, canonicalRoot)) throw new Error(`${name.toUpperCase()}_UNEXPECTED_ANCESTOR_REDIRECTION`);
  if (expectedCanonicalRoot !== null) {
    const expected = fs.realpathSync(expectedCanonicalRoot); const expectedStat = fs.lstatSync(expected);
    if (canonicalRoot !== expected || !sameIdentity(canonicalStat, expectedStat)) throw new Error(`${name.toUpperCase()}_CANONICAL_MISMATCH`);
  }
  return identityRecord(resolved, canonicalRoot, canonicalStat);
}

export function assertBoundaryRootIdentity(evidence) {
  if (!evidence || evidence.exists !== true || evidence.type !== "directory") throw new Error("BOUNDARY_ROOT_EVIDENCE_INCOMPLETE");
  const current = captureBoundaryRoot(evidence.rawRoot, { expectedCanonicalRoot: evidence.canonicalRoot });
  if (current.device !== evidence.device || current.inode !== evidence.inode || current.ownerUid !== evidence.ownerUid || current.mode !== evidence.mode) throw new Error("BOUNDARY_ROOT_REPLACED");
  return current;
}

function isInsideOrEqual(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertNoBoundaryOverlap(roots) {
  const protectedRoots = [roots.authorityRoot, roots.controllerRoot, roots.targetRoot];
  for (let left = 0; left < protectedRoots.length; left += 1) for (let right = left + 1; right < protectedRoots.length; right += 1) {
    if (isInsideOrEqual(protectedRoots[left].canonicalRoot, protectedRoots[right].canonicalRoot) || isInsideOrEqual(protectedRoots[right].canonicalRoot, protectedRoots[left].canonicalRoot)) throw new Error("BOUNDARY_PROTECTED_ROOT_OVERLAP");
    if (protectedRoots[left].device === protectedRoots[right].device && protectedRoots[left].inode === protectedRoots[right].inode) throw new Error("BOUNDARY_PROTECTED_IDENTITY_OVERLAP");
  }
  for (const protectedRoot of protectedRoots) {
    const output = roots.roleOutputRoot;
    if (isInsideOrEqual(output.canonicalRoot, protectedRoot.canonicalRoot) || isInsideOrEqual(protectedRoot.canonicalRoot, output.canonicalRoot)) throw new Error("BOUNDARY_OUTPUT_PROTECTED_OVERLAP");
    if (output.exists && output.device === protectedRoot.device && output.inode === protectedRoot.inode) throw new Error("BOUNDARY_OUTPUT_PROTECTED_IDENTITY_OVERLAP");
  }
}

export function roleSandboxProfile({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot }) {
  const roots = Object.freeze({ authorityRoot: captureBoundaryRoot(authorityRoot, { name: "authorityRoot" }), controllerRoot: captureBoundaryRoot(controllerRoot, { name: "controllerRoot" }), targetRoot: captureBoundaryRoot(targetRoot, { name: "targetRoot" }), roleOutputRoot: captureBoundaryRoot(roleOutputRoot, { name: "roleOutputRoot", allowMissingLeaf: true }) });
  assertNoBoundaryOverlap(roots);
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    `(deny file-read* file-write* (subpath ${quote(roots.authorityRoot.canonicalRoot)}))`,
    `(deny file-write* (subpath ${quote(roots.controllerRoot.canonicalRoot)}))`,
    `(deny file-write* (subpath ${quote(roots.targetRoot.canonicalRoot)}))`,
    `(allow file-write* (subpath ${quote(roots.roleOutputRoot.canonicalRoot)}))`,
  ].join(" ");
  return Object.freeze({ profile, digest: sha256Canonical({ profile }), roots });
}

function detailedProbeSource() {
  function program() {
    const fs = require("node:fs"); const path = require("node:path"); const { spawnSync } = require("node:child_process");
    const probe = (operation, action, allowed) => { try { action(); return { operation, result: allowed ? "ALLOWED" : "ALLOWED_FORBIDDEN", errorCode: null }; } catch (error) { return { operation, result: ["EPERM", "EACCES"].includes(error.code) ? "DENIED" : "UNEXPECTED_ERROR", errorCode: error.code ?? null }; } };
    const direct = [probe("authority-read", () => fs.readFileSync(path.join(process.env.AUTHORITY_ROOT, "sentinel")), false), probe("authority-write", () => fs.writeFileSync(path.join(process.env.AUTHORITY_ROOT, "direct-write"), "forbidden"), false), probe("controller-write", () => fs.writeFileSync(path.join(process.env.CONTROLLER_ROOT, "direct-write"), "forbidden"), false), probe("target-write", () => fs.writeFileSync(path.join(process.env.TARGET_ROOT, "direct-write"), "forbidden"), false), probe("role-output-write", () => fs.writeFileSync(path.join(process.env.ROLE_OUTPUT_ROOT, "allowed-result"), "allowed\n"), true)];
    function descendant() {
      const fs = require("node:fs"); const path = require("node:path"); const probe = (operation, action) => { try { action(); return { operation, result: "ALLOWED_FORBIDDEN", errorCode: null }; } catch (error) { return { operation, result: ["EPERM", "EACCES"].includes(error.code) ? "DENIED" : "UNEXPECTED_ERROR", errorCode: error.code ?? null }; } };
      process.stdout.write(JSON.stringify([probe("descendant-authority-read", () => fs.readFileSync(path.join(process.env.AUTHORITY_ROOT, "sentinel"))), probe("descendant-authority-write", () => fs.writeFileSync(path.join(process.env.AUTHORITY_ROOT, "child-write"), "forbidden")), probe("descendant-controller-write", () => fs.writeFileSync(path.join(process.env.CONTROLLER_ROOT, "child-write"), "forbidden")), probe("descendant-target-write", () => fs.writeFileSync(path.join(process.env.TARGET_ROOT, "child-write"), "forbidden"))]));
    }
    const child = spawnSync(process.execPath, ["-e", `(${descendant.toString()})()`], { env: process.env, encoding: "utf8" }); let descendantResults = null; try { descendantResults = JSON.parse(child.stdout); } catch {}
    const python = ["import ctypes, json, os", "lib=ctypes.CDLL('/usr/lib/libsandbox.dylib')", "check=lib.sandbox_check", "check.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int]", "check.restype=ctypes.c_int", "print(json.dumps({name:check(os.getpid(),name.encode(),0) for name in ('network-inbound','network-outbound')}))"].join("\n");
    const networkChild = spawnSync("/usr/bin/python3", ["-B", "-c", python], { encoding: "utf8" }); let values = null; try { values = JSON.parse(networkChild.stdout); } catch {}
    const network = values === null ? null : Object.entries(values).map(([operation, value]) => ({ operation, result: value === 1 ? "DENIED" : "ALLOWED_FORBIDDEN", errorCode: null }));
    process.stdout.write(JSON.stringify({ direct, descendant: descendantResults, childExitStatus: child.status, network, networkChildExitStatus: networkChild.status }));
  }
  return `(${program.toString()})()`;
}

function boundaryName(operation) {
  if (operation.includes("authority")) return "authorityRoot";
  if (operation.includes("controller")) return "controllerRoot";
  if (operation.includes("target")) return "targetRoot";
  if (operation === "role-output-write") return "roleOutputRoot";
  return null;
}

function diagnosticRecord(record, roots, childExitStatus) {
  const name = boundaryName(record.operation); const evidence = name === null ? null : roots[name]; let observedIdentity = null;
  if (evidence?.exists) { try { const current = assertBoundaryRootIdentity(evidence); observedIdentity = { device: current.device, inode: current.inode }; } catch (error) { observedIdentity = { error: error.message }; } }
  return Object.freeze({ operation: record.operation, rawRoot: evidence?.rawRoot ?? null, canonicalRoot: evidence?.canonicalRoot ?? null, expectedIdentity: evidence === null ? null : { device: evidence.device, inode: evidence.inode }, observedIdentity, result: record.result, errorCode: record.errorCode ?? null, childExitStatus });
}

export function runConfinementDiagnostic({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot }) {
  const policy = roleSandboxProfile({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot });
  for (const evidence of Object.values(policy.roots)) if (evidence.exists) assertBoundaryRootIdentity(evidence);
  if (!policy.roots.roleOutputRoot.exists) throw new Error("ROLE_OUTPUT_ROOT_MUST_EXIST_FOR_PROBE");
  const env = { ...process.env, AUTHORITY_ROOT: policy.roots.authorityRoot.canonicalRoot, CONTROLLER_ROOT: policy.roots.controllerRoot.canonicalRoot, TARGET_ROOT: policy.roots.targetRoot.canonicalRoot, ROLE_OUTPUT_ROOT: policy.roots.roleOutputRoot.canonicalRoot };
  const result = spawnSync("/usr/bin/sandbox-exec", ["-p", policy.profile, "/usr/local/bin/node", "-e", detailedProbeSource()], { env, encoding: "utf8" }); let output = null; try { output = JSON.parse(result.stdout); } catch {}
  const direct = Array.isArray(output?.direct) ? output.direct.map((item) => diagnosticRecord(item, policy.roots, null)) : null;
  const descendant = Array.isArray(output?.descendant) ? output.descendant.map((item) => diagnosticRecord(item, policy.roots, output.childExitStatus)) : null;
  const network = Array.isArray(output?.network) ? output.network.map((item) => diagnosticRecord(item, policy.roots, output.networkChildExitStatus)) : null;
  const forbiddenArtifacts = [["authorityRoot", "direct-write"], ["authorityRoot", "child-write"], ["controllerRoot", "direct-write"], ["controllerRoot", "child-write"], ["targetRoot", "direct-write"], ["targetRoot", "child-write"]].map(([root, name]) => path.join(policy.roots[root].canonicalRoot, name)).filter((item) => fs.existsSync(item));
  const postIdentityErrors = []; for (const [name, evidence] of Object.entries(policy.roots)) if (evidence.exists) { try { assertBoundaryRootIdentity(evidence); } catch (error) { postIdentityErrors.push({ name, error: error.message }); } }
  return Object.freeze({ policyDigest: policy.digest, roots: policy.roots, sandboxExitStatus: result.status, childExitStatus: output?.childExitStatus ?? null, networkChildExitStatus: output?.networkChildExitStatus ?? null, direct, descendant, network, forbiddenArtifacts, postIdentityErrors, stderr: result.stderr.trim() });
}

export function assertConfinementProbeResults(diagnostic) {
  if (!diagnostic || diagnostic.sandboxExitStatus !== 0 || diagnostic.childExitStatus !== 0 || diagnostic.networkChildExitStatus !== 0 || diagnostic.stderr !== "" || !Array.isArray(diagnostic.direct) || !Array.isArray(diagnostic.descendant) || !Array.isArray(diagnostic.network)) throw new Error("CONFINEMENT_PROBE_INCOMPLETE");
  const records = [...diagnostic.direct, ...diagnostic.descendant, ...diagnostic.network]; const expected = new Map([...FILE_PROBES.map(([operation, , result]) => [operation, result]), ...NETWORK_PROBES.map((operation) => [operation, "DENIED"])]);
  if (records.length !== expected.size || new Set(records.map((item) => item.operation)).size !== expected.size) throw new Error("CONFINEMENT_PROBE_RESULT_SET_INVALID");
  for (const [operation, expectedResult] of expected) {
    const record = records.find((item) => item.operation === operation);
    const errorIsExpected = operation.startsWith("network-") || expectedResult === "ALLOWED"
      ? record?.errorCode === null
      : ["EPERM", "EACCES"].includes(record?.errorCode);
    if (!record || record.result !== expectedResult || !errorIsExpected) throw new Error(`CONFINEMENT_PROBE_FAILED:${operation}:${record?.result ?? "MISSING"}:${record?.errorCode ?? "NONE"}`);
    if (!operation.startsWith("network-") && (record.rawRoot === null || record.canonicalRoot === null || record.expectedIdentity === null || record.observedIdentity === null || "error" in record.observedIdentity || record.expectedIdentity.device !== record.observedIdentity.device || record.expectedIdentity.inode !== record.observedIdentity.inode)) throw new Error(`CONFINEMENT_PROBE_IDENTITY_FAILED:${operation}`);
  }
  if (diagnostic.forbiddenArtifacts.length !== 0 || diagnostic.postIdentityErrors.length !== 0) throw new Error("CONFINEMENT_PROBE_SIDE_EFFECT_OR_IDENTITY_DRIFT");
  return true;
}

const REAL_PERMISSION_CHECKS = Object.freeze([
  ["authority-read", "authorityRoot", "file-read-data", "DENIED"],
  ["authority-write", "authorityRoot", "file-write-data", "DENIED"],
  ["controller-write", "controllerRoot", "file-write-data", "DENIED"],
  ["target-write", "targetRoot", "file-write-data", "DENIED"],
  ["role-output-write", "roleOutputRoot", "file-write-data", "ALLOWED"],
  ["network-inbound", null, "network-inbound", "DENIED"],
  ["network-outbound", null, "network-outbound", "DENIED"],
]);

function nativePermissionProbeSource() {
  return [
    "import ctypes,json,os,subprocess,sys",
    "lib=ctypes.CDLL('/usr/lib/libsandbox.dylib')",
    "check=lib.sandbox_check",
    "check.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int]",
    "check.restype=ctypes.c_int",
    "roots=json.loads(os.environ['GOV002_NATIVE_ROOTS'])",
    "checks=json.loads(os.environ['GOV002_NATIVE_CHECKS'])",
    "def query(item):",
    " operation,subject,native_operation,expected=item",
    " status=check(os.getpid(),native_operation.encode(),0) if subject is None else check(os.getpid(),native_operation.encode(),1,ctypes.c_char_p(roots[subject].encode()))",
    " return {'operation':operation,'subject':subject,'nativeOperation':native_operation,'expectedPermission':expected,'nativeStatus':status}",
    "def query_all(): return [query(item) for item in checks]",
    "if '--descendant' in sys.argv:",
    " print(json.dumps(query_all()))",
    " raise SystemExit(0)",
    "child=subprocess.run([sys.executable,'-B','-c',os.environ['GOV002_NATIVE_SOURCE'],'--descendant'],capture_output=True,text=True,env=os.environ)",
    "descendant=None",
    "try: descendant=json.loads(child.stdout)",
    "except Exception: pass",
    "print(json.dumps({'direct':query_all(),'descendant':descendant,'childExitStatus':child.returncode,'childStderr':child.stderr}))",
  ].join("\n");
}

function permissionFromNativeStatus(status) {
  if (status === 1) return "DENIED";
  if (status === 0) return "ALLOWED";
  return "QUERY_ERROR";
}

function realEvidenceRecord(item, context, roots, postflightRoots) {
  const preflight = item.subject === null ? null : roots[item.subject];
  const postflight = item.subject === null ? null : postflightRoots[item.subject];
  return Object.freeze({
    operation: item.operation,
    subject: item.subject,
    rawPath: preflight?.rawRoot ?? null,
    canonicalPath: preflight?.canonicalRoot ?? null,
    expectedPermission: item.expectedPermission,
    observedPermission: permissionFromNativeStatus(item.nativeStatus),
    nativeOperation: item.nativeOperation,
    nativeStatus: item.nativeStatus,
    context,
    preflightIdentity: preflight === null ? null : { type: preflight.type, device: preflight.device, inode: preflight.inode, ownerUid: preflight.ownerUid, mode: preflight.mode },
    postflightIdentity: postflight === null ? null : { type: postflight.type, device: postflight.device, inode: postflight.inode, ownerUid: postflight.ownerUid, mode: postflight.mode },
  });
}

export function assertRealConfinementEvidence(evidence, { expectedControllerRoot = null, expectedAuthorityRoot = null, expectedTargetRoot = null } = {}) {
  if (!evidence || evidence.mechanism !== "MACOS_SANDBOX_CHECK" || evidence.sandboxExitStatus !== 0 || evidence.descendantExitStatus !== 0 || evidence.stderr !== "" || evidence.descendantStderr !== "" || evidence.protectedPathMutationAttempts !== 0 || !Array.isArray(evidence.records)) throw new Error("REAL_CONFINEMENT_EVIDENCE_INCOMPLETE");
  const expectedCount = REAL_PERMISSION_CHECKS.length * 2;
  const keys = evidence.records.map((item) => `${item.context}:${item.operation}`);
  if (evidence.records.length !== expectedCount || new Set(keys).size !== expectedCount) throw new Error("REAL_CONFINEMENT_RESULT_SET_INVALID");
  for (const context of ["direct", "descendant"]) for (const [operation, subject, nativeOperation, expectedPermission] of REAL_PERMISSION_CHECKS) {
    const record = evidence.records.find((item) => item.context === context && item.operation === operation);
    if (!record || record.subject !== subject || record.nativeOperation !== nativeOperation || record.expectedPermission !== expectedPermission) throw new Error(`REAL_CONFINEMENT_RESULT_MISSING:${context}:${operation}`);
    if (![0, 1].includes(record.nativeStatus) || record.observedPermission !== expectedPermission) throw new Error(`REAL_CONFINEMENT_PERMISSION_FAILED:${context}:${operation}:${record.observedPermission}:${record.nativeStatus}`);
    if (subject !== null && (record.rawPath === null || record.canonicalPath === null || record.preflightIdentity?.type !== "directory" || JSON.stringify(record.preflightIdentity) !== JSON.stringify(record.postflightIdentity))) throw new Error(`REAL_CONFINEMENT_IDENTITY_DRIFT:${context}:${operation}`);
  }
  const roots = evidence.roots;
  if (!roots || (expectedControllerRoot !== null && roots.controllerRoot.canonicalRoot !== expectedControllerRoot) || (expectedAuthorityRoot !== null && roots.authorityRoot.canonicalRoot !== expectedAuthorityRoot) || (expectedTargetRoot !== null && roots.targetRoot.canonicalRoot !== expectedTargetRoot)) throw new Error("REAL_CONFINEMENT_FIXED_ROOT_MISMATCH");
  return true;
}

export function runNativePermissionDiagnostic({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot }) {
  const policy = roleSandboxProfile({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot });
  for (const root of Object.values(policy.roots)) assertBoundaryRootIdentity(root);
  const source = nativePermissionProbeSource();
  const env = { ...process.env, GOV002_NATIVE_ROOTS: JSON.stringify(Object.fromEntries(Object.entries(policy.roots).map(([name, root]) => [name, root.canonicalRoot]))), GOV002_NATIVE_CHECKS: JSON.stringify(REAL_PERMISSION_CHECKS), GOV002_NATIVE_SOURCE: source };
  const result = spawnSync("/usr/bin/sandbox-exec", ["-p", policy.profile, "/usr/bin/python3", "-B", "-c", source], { env, encoding: "utf8" });
  let output = null; try { output = JSON.parse(result.stdout); } catch {}
  const postflightRoots = {};
  for (const [name, root] of Object.entries(policy.roots)) postflightRoots[name] = assertBoundaryRootIdentity(root);
  const direct = Array.isArray(output?.direct) ? output.direct.map((item) => realEvidenceRecord(item, "direct", policy.roots, postflightRoots)) : [];
  const descendant = Array.isArray(output?.descendant) ? output.descendant.map((item) => realEvidenceRecord(item, "descendant", policy.roots, postflightRoots)) : [];
  const evidence = Object.freeze({ mechanism: "MACOS_SANDBOX_CHECK", policyDigest: policy.digest, roots: policy.roots, records: Object.freeze([...direct, ...descendant]), sandboxExitStatus: result.status, descendantExitStatus: output?.childExitStatus ?? null, stderr: result.stderr.trim(), descendantStderr: output?.childStderr?.trim() ?? "", protectedPathMutationAttempts: 0 });
  assertRealConfinementEvidence(evidence);
  return evidence;
}

export function runRealConfinementDiagnostic({ roleOutputRoot }) {
  const evidence = runNativePermissionDiagnostic({ authorityRoot: PRODUCTION_AUTHORITY_ROOT, controllerRoot: PRODUCTION_CONTROLLER_ROOT, targetRoot: PROTECTED_REAL_TARGET_ROOT, roleOutputRoot });
  assertRealConfinementEvidence(evidence, { expectedAuthorityRoot: fs.realpathSync(PRODUCTION_AUTHORITY_ROOT), expectedControllerRoot: fs.realpathSync(PRODUCTION_CONTROLLER_ROOT), expectedTargetRoot: fs.realpathSync(PROTECTED_REAL_TARGET_ROOT) });
  return evidence;
}

export function verifyDisposableConfinement({ now = new Date().toISOString() } = {}) {
  const temporaryRoot = captureBoundaryRoot(os.tmpdir(), { name: "temporaryRoot" });
  const root = fs.mkdtempSync(path.join(temporaryRoot.canonicalRoot, "gov002-role-boundary-")); const authorityRoot = path.join(root, "authority"); const controllerRoot = path.join(root, "controller"); const targetRoot = path.join(root, "target"); const roleOutputRoot = path.join(root, "role-output");
  try {
    for (const item of [authorityRoot, controllerRoot, targetRoot, roleOutputRoot]) fs.mkdirSync(item, { mode: 0o700 }); fs.writeFileSync(path.join(authorityRoot, "sentinel"), "authority\n", { mode: 0o600 });
    const diagnostic = runConfinementDiagnostic({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot });
    try { assertConfinementProbeResults(diagnostic); } catch (error) { const safe = { reason: error.message, sandboxExitStatus: diagnostic.sandboxExitStatus, childExitStatus: diagnostic.childExitStatus, networkChildExitStatus: diagnostic.networkChildExitStatus, direct: diagnostic.direct, descendant: diagnostic.descendant, network: diagnostic.network, forbiddenArtifacts: diagnostic.forbiddenArtifacts, postIdentityErrors: diagnostic.postIdentityErrors }; throw new Error(`ROLE_FILESYSTEM_CONFINEMENT_UNAVAILABLE:${JSON.stringify(safe)}`); }
    return Object.freeze({ schemaVersion: 1, mechanism: "MACOS_SANDBOX_EXEC", policyDigest: diagnostic.policyDigest, networkDenied: true, authorityReadDenied: true, authorityWriteDenied: true, controllerWriteDenied: true, targetWriteDenied: true, descendantsDenied: true, verifiedAt: now });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

export function assertProductionAuthorityLocation(statePath) {
  const identity = authorityStoreIdentity(statePath);
  if (identity.canonicalRoot !== PRODUCTION_AUTHORITY_ROOT) throw new Error("REAL_AUTHORITY_STORE_LOCATION_REQUIRED");
  const mode = fs.lstatSync(identity.canonicalRoot).mode & 0o777;
  if (mode !== 0o700) throw new Error("REAL_AUTHORITY_STORE_MODE_INVALID");
  return identity;
}

export function assertAuthorityStoreBinding(statePath, stored) {
  const current = authorityStoreIdentity(statePath);
  if (stored.canonicalStatePath !== current.canonicalStatePath || stored.authorityStoreId !== current.authorityStoreId) throw new Error("AUTHORITY_STORE_BINDING_MISMATCH");
  return current;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export function assertTrustedAuthoritySource({ statePath, targetRoot, stored = null }) {
  const canonicalTargetRoot = fs.realpathSync(targetRoot);
  let current;
  let authorityClass;
  if (canonicalTargetRoot === fs.realpathSync(PROTECTED_REAL_TARGET_ROOT)) {
    current = assertProductionAuthorityLocation(statePath);
    authorityClass = "PRODUCTION";
  } else {
    if (process.env[DISPOSABLE_AUTHORITY_TEST_FLAG] !== "1") throw new Error("DISPOSABLE_AUTHORITY_TEST_SCOPE_REQUIRED");
    current = authorityStoreIdentity(statePath);
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    if (!isInside(temporaryRoot, canonicalTargetRoot) || !isInside(temporaryRoot, current.canonicalRoot)) throw new Error("DISPOSABLE_AUTHORITY_OUTSIDE_TEST_ROOT");
    authorityClass = "DISPOSABLE_TEST";
  }
  if (stored !== null) {
    if (stored.canonicalStatePath !== current.canonicalStatePath || stored.canonicalRoot !== current.canonicalRoot || stored.authorityStoreId !== current.authorityStoreId) throw new Error("AUTHORITY_STORE_BINDING_MISMATCH");
    const expectedMechanism = authorityClass === "PRODUCTION" ? "MACOS_SANDBOX_EXEC" : "DISPOSABLE_TARGET_BOUNDARY";
    if (stored.boundary?.mechanism !== expectedMechanism) throw new Error("AUTHORITY_BOUNDARY_MECHANISM_MISMATCH");
  }
  return Object.freeze({ ...current, authorityClass, canonicalTargetRoot });
}
