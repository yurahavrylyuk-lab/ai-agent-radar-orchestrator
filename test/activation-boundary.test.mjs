import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertBoundaryRootIdentity,
  assertConfinementProbeResults,
  captureBoundaryRoot,
  roleSandboxProfile,
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
