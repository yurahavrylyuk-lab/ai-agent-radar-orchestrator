import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertBoundaryRootIdentity,
  assertConfinementProbeResults,
  assertRealConfinementEvidence,
  captureBoundaryRoot,
  PRODUCTION_AUTHORITY_ROOT,
  PRODUCTION_CONTROLLER_ROOT,
  PROTECTED_REAL_TARGET_ROOT,
  roleSandboxProfile,
  runRealConfinementDiagnostic,
} from "../src/operator-boundary.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "gov002-boundary-test-"));
  const roots = Object.fromEntries(["authorityRoot", "controllerRoot", "targetRoot", "roleOutputRoot"].map((name) => {
    const value = path.join(root, name);
    fs.mkdirSync(value, { mode: 0o700 });
    return [name, value];
  }));
  fs.writeFileSync(path.join(roots.authorityRoot, "sentinel"), "authority\n", { mode: 0o600 });
  return { root, roots, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("activation role policy combines network denial with authority, controller, and target confinement", () => {
  const value = fixture();
  try {
    const policy = roleSandboxProfile(value.roots);
    assert.match(policy.profile, /deny network\*/u);
    assert.match(policy.profile, /deny file-read\* file-write\*/u);
    for (const name of ["authorityRoot", "controllerRoot", "targetRoot", "roleOutputRoot"]) {
      assert.equal(policy.roots[name].canonicalRoot, fs.realpathSync(value.roots[name]));
      assert.match(policy.profile, new RegExp(policy.roots[name].canonicalRoot.replaceAll("/", "\\/"), "u"));
    }
    assert.match(policy.profile, /allow file-write\*/u);
    assert.match(policy.digest, /^[0-9a-f]{64}$/u);
  } finally { value.cleanup(); }
});

test("known macOS /var alias is accepted only after canonical identity equivalence is proved", () => {
  const evidence = captureBoundaryRoot(os.tmpdir(), { name: "temporaryRoot" });
  assert.equal(evidence.rawRoot.startsWith("/var/"), true);
  assert.equal(evidence.canonicalRoot, `/private${evidence.rawRoot}`);
  const rawStat = fs.statSync(evidence.rawRoot);
  const canonicalStat = fs.statSync(evidence.canonicalRoot);
  assert.deepEqual([rawStat.dev, rawStat.ino], [canonicalStat.dev, canonicalStat.ino]);
  assert.deepEqual([evidence.device, evidence.inode], [canonicalStat.dev, canonicalStat.ino]);
});

test("similar-looking but different directories fail expected canonical identity", () => {
  const value = fixture();
  try {
    const other = path.join(value.root, "authorityRoot-copy");
    fs.mkdirSync(other);
    assert.throws(() => captureBoundaryRoot(value.roots.authorityRoot, { name: "authorityRoot", expectedCanonicalRoot: other }), /AUTHORITYROOT_CANONICAL_MISMATCH/u);
  } finally { value.cleanup(); }
});

test("symlink leaf substitution and unexpected ancestor redirection fail closed", () => {
  const value = fixture();
  try {
    const leaf = path.join(value.root, "leaf-link");
    fs.symlinkSync(value.roots.authorityRoot, leaf);
    assert.throws(() => captureBoundaryRoot(leaf, { name: "authorityRoot" }), /AUTHORITYROOT_SYMLINK_LEAF/u);
    const redirectedParent = path.join(value.root, "redirected-parent");
    fs.symlinkSync(value.root, redirectedParent);
    assert.throws(() => captureBoundaryRoot(path.join(redirectedParent, "authorityRoot"), { name: "authorityRoot" }), /AUTHORITYROOT_UNEXPECTED_ANCESTOR_REDIRECTION/u);
  } finally { value.cleanup(); }
});

test("directory replacement is detected by device and inode evidence", () => {
  const value = fixture();
  try {
    const evidence = captureBoundaryRoot(value.roots.authorityRoot, { name: "authorityRoot" });
    fs.renameSync(value.roots.authorityRoot, `${value.roots.authorityRoot}-old`);
    fs.mkdirSync(value.roots.authorityRoot, { mode: 0o700 });
    assert.throws(() => assertBoundaryRootIdentity(evidence), /BOUNDARY_ROOT_REPLACED/u);
  } finally { value.cleanup(); }
});

test("traversal and protected/output overlap are rejected", () => {
  const value = fixture();
  try {
    const traversing = `${value.root}/authorityRoot/../authorityRoot`;
    assert.throws(() => captureBoundaryRoot(traversing, { name: "authorityRoot" }), /PATH_TRAVERSAL_OR_NONCANONICAL/u);
    const unsafe = { ...value.roots, roleOutputRoot: path.join(value.roots.authorityRoot, "output") };
    fs.mkdirSync(unsafe.roleOutputRoot);
    assert.throws(() => roleSandboxProfile(unsafe), /BOUNDARY_OUTPUT_PROTECTED_OVERLAP/u);
  } finally { value.cleanup(); }
});

test("independent direct, descendant, output, and network probes all enforce confinement", () => {
  const diagnostic = JSON.parse(process.env.GOV002_FS_BOUNDARY_EVIDENCE);
  assert.equal(assertConfinementProbeResults(diagnostic), true);
  const records = [...diagnostic.direct, ...diagnostic.descendant, ...diagnostic.network];
  const expected = {
    "authority-read": "DENIED", "authority-write": "DENIED", "controller-write": "DENIED", "target-write": "DENIED",
    "role-output-write": "ALLOWED", "descendant-authority-read": "DENIED", "descendant-authority-write": "DENIED",
    "descendant-controller-write": "DENIED", "descendant-target-write": "DENIED", "network-inbound": "DENIED", "network-outbound": "DENIED",
  };
  assert.deepEqual(Object.fromEntries(records.map(({ operation, result }) => [operation, result])), expected);
  assert.deepEqual(diagnostic.forbiddenArtifacts, []);
  assert.deepEqual(diagnostic.postIdentityErrors, []);
});

test("missing probe results and unexpected probe errors fail closed", () => {
  const diagnostic = JSON.parse(process.env.GOV002_FS_BOUNDARY_EVIDENCE);
  const missing = structuredClone(diagnostic);
  missing.direct.pop();
  assert.throws(() => assertConfinementProbeResults(missing), /CONFINEMENT_PROBE_RESULT_SET_INVALID/u);
  const unexpected = structuredClone(diagnostic);
  unexpected.direct[0].result = "UNEXPECTED_ERROR";
  unexpected.direct[0].errorCode = "EIO";
  assert.throws(() => assertConfinementProbeResults(unexpected), /CONFINEMENT_PROBE_FAILED:authority-read:UNEXPECTED_ERROR:EIO/u);
});

test("standalone real diagnostic is fixed to policy-owned production roots and has no authorization call path", () => {
  assert.equal(PRODUCTION_AUTHORITY_ROOT, "/Users/yuriy/Library/Application Support/AI Agent Radar Orchestrator/authority");
  assert.equal(PRODUCTION_CONTROLLER_ROOT, "/Users/yuriy/Documents/IT Study/General/General/AI Agents/ai-agent-radar-orchestrator");
  assert.equal(PROTECTED_REAL_TARGET_ROOT, "/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent");
  const source = runRealConfinementDiagnostic.toString();
  assert.match(source, /PRODUCTION_AUTHORITY_ROOT/u);
  assert.match(source, /PRODUCTION_CONTROLLER_ROOT/u);
  assert.match(source, /PROTECTED_REAL_TARGET_ROOT/u);
  assert.doesNotMatch(source, /authoriz|proposal|digest|ledger|grant|cycle|pilot|integrat/iu);
});

test("native permission evidence covers direct and descendant checks without mutation attempts", () => {
  const evidence = JSON.parse(process.env.GOV002_NATIVE_BOUNDARY_EVIDENCE);
  assert.equal(assertRealConfinementEvidence(evidence), true);
  assert.equal(evidence.protectedPathMutationAttempts, 0);
  assert.equal(evidence.records.filter((item) => item.context === "direct").length, 7);
  assert.equal(evidence.records.filter((item) => item.context === "descendant").length, 7);
});

test("native query errors and missing direct or descendant evidence fail closed", () => {
  const accepted = JSON.parse(process.env.GOV002_NATIVE_BOUNDARY_EVIDENCE);
  const queryError = structuredClone(accepted);
  queryError.records[0].nativeStatus = -1;
  queryError.records[0].observedPermission = "QUERY_ERROR";
  assert.throws(() => assertRealConfinementEvidence(queryError), /REAL_CONFINEMENT_PERMISSION_FAILED/u);
  const missingDirect = structuredClone(accepted);
  missingDirect.records.splice(missingDirect.records.findIndex((item) => item.context === "direct"), 1);
  assert.throws(() => assertRealConfinementEvidence(missingDirect), /REAL_CONFINEMENT_RESULT_SET_INVALID/u);
  const missingDescendant = structuredClone(accepted);
  missingDescendant.records.splice(missingDescendant.records.findIndex((item) => item.context === "descendant"), 1);
  assert.throws(() => assertRealConfinementEvidence(missingDescendant), /REAL_CONFINEMENT_RESULT_SET_INVALID/u);
});

test("allowed forbidden permissions, denied output, and identity drift fail closed", () => {
  const accepted = JSON.parse(process.env.GOV002_NATIVE_BOUNDARY_EVIDENCE);
  const forbiddenAllowed = structuredClone(accepted);
  const authorityWrite = forbiddenAllowed.records.find((item) => item.context === "direct" && item.operation === "authority-write");
  authorityWrite.nativeStatus = 0;
  authorityWrite.observedPermission = "ALLOWED";
  assert.throws(() => assertRealConfinementEvidence(forbiddenAllowed), /REAL_CONFINEMENT_PERMISSION_FAILED/u);
  const outputDenied = structuredClone(accepted);
  const output = outputDenied.records.find((item) => item.context === "direct" && item.operation === "role-output-write");
  output.nativeStatus = 1;
  output.observedPermission = "DENIED";
  assert.throws(() => assertRealConfinementEvidence(outputDenied), /REAL_CONFINEMENT_PERMISSION_FAILED/u);
  const drift = structuredClone(accepted);
  drift.records.find((item) => item.context === "descendant" && item.subject !== null).postflightIdentity.inode += 1;
  assert.throws(() => assertRealConfinementEvidence(drift), /REAL_CONFINEMENT_IDENTITY_DRIFT/u);
});

test("offline wrapper retains TAP aggregate evidence without hardcoding a total", () => {
  const source = fs.readFileSync(fileURLToPath(new URL("../scripts/test-offline.sh", import.meta.url)), "utf8");
  assert.match(source, /--test-reporter=tap/u);
  assert.match(source, /OFFLINE_RUNNER_AGGREGATE tests=%s pass=%s fail=%s/u);
  assert.match(source, /OFFLINE_WRAPPER_CHECKS pass=%s fail=0/u);
  assert.doesNotMatch(source, /(?:tests|pass|fail)[=: ]+149/u);
});

test("mandatory wrapper supplied native direct and descendant filesystem-denial evidence", () => {
  assert.equal(process.env.GOV002_FS_BOUNDARY_PROVED, "MACOS_SANDBOX_EXEC_DIRECT_AND_DESCENDANT_DENIAL");
});

test("activation runtime has no provider, publication, scheduling, or automatic role-launch adapter", () => {
  const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
  const files = fs.readdirSync(sourceRoot).filter((name) => name.endsWith(".mjs"));
  const activationFiles = files.filter((name) => /^(?:pilot-authorization|operator-boundary|controller-identity|controller-remote-policy|real-pilot-admission|real-local-integration|cli)\.mjs$/u.test(name));
  const source = activationFiles.map((name) => fs.readFileSync(path.join(sourceRoot, name), "utf8")).join("\n");
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
  assert.doesNotMatch(source, /\b(?:Brave|Gemini|OpenAI|Resend)\b/u);
  assert.doesNotMatch(source, /\[\s*["']push["']/u);
  assert.doesNotMatch(source, /\b(?:cron|scheduled\s*\()/iu);
  assert.doesNotMatch(source, /\b(?:codex|cursor)\s+(?:exec|agent|run)\b/iu);
});
