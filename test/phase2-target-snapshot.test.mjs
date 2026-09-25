import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { git } from "../src/git-evidence.mjs";
import { assertSemanticIndexInvariant, captureSemanticIndex, captureTargetSnapshot, compareTargetSnapshots, SEMANTIC_INDEX_FORMAT } from "../src/target-snapshot.mjs";
import { runtimeDirectory } from "./helpers/phase2-fixture.mjs";

function fixture(name, files = [["file.txt", "one\n"]]) {
  const root = runtimeDirectory(name); git(root, ["init", "-b", "self-improvement"], { write: true });
  for (const [relative, content] of files) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  git(root, ["add", "-A"], { write: true }); git(root, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "--no-gpg-sign", "-m", "base"], { write: true }); return root;
}
function rawIndexDigest(root) { const gitDir = git(root, ["rev-parse", "--git-dir"]).stdout.trim(); return crypto.createHash("sha256").update(fs.readFileSync(path.resolve(root, gitDir, "index"))).digest("hex"); }
function expectSemanticFailure(root, pattern = /SEMANTIC_INDEX/) { const snapshot = captureTargetSnapshot(root); assert.throws(() => assertSemanticIndexInvariant(snapshot), pattern); return snapshot; }

test("target snapshot semantic index is deterministic and NUL-safe for unusual filenames", () => {
  const names = ["plain.txt", "space name.txt", "tab\tname.txt", "line\nname.txt"]; const root = fixture("snapshot-unusual", names.map((name) => [name, `${name.length}\n`]));
  const first = captureTargetSnapshot(root); const second = captureTargetSnapshot(root); assert.deepEqual(compareTargetSnapshots(first, second), { equal: true, changed: [] }); assert.equal(first.semanticIndex.format, SEMANTIC_INDEX_FORMAT); assert.equal(first.semanticIndex.entryCount, names.length); assert.equal(assertSemanticIndexInvariant(first), true);
  const decoded = captureSemanticIndex(root).entries.map((entry) => Buffer.from(entry.pathBase64, "base64").toString("utf8")).sort(); assert.deepEqual(decoded, names.sort());
});

test("stat-cache-only index rewrite changes raw bytes but preserves semantic target identity", () => {
  const root = fixture("snapshot-stat-cache"); const before = captureTargetSnapshot(root); const rawBefore = rawIndexDigest(root); const file = path.join(root, "file.txt"); const stat = fs.statSync(file); fs.utimesSync(file, stat.atime, new Date(stat.mtimeMs + 5000));
  git(root, ["status", "--porcelain=v1", "--untracked-files=all"], { write: true });
  const rawAfter = rawIndexDigest(root); const after = captureTargetSnapshot(root); assert.notEqual(rawAfter, rawBefore); assert.equal(after.semanticIndex.digest, before.semanticIndex.digest); assert.deepEqual(compareTargetSnapshots(before, after), { equal: true, changed: [] }); assert.equal(after.manifestDigest, before.manifestDigest); assert.equal(after.modesDigest, before.modesDigest); assert.equal(after.refs, before.refs); assert.equal(after.statusDigest, before.statusDigest); assert.equal(assertSemanticIndexInvariant(after), true);
});

test("unstaged content and status drift fails target preservation", () => {
  const root = fixture("snapshot-unstaged"); const before = captureTargetSnapshot(root); fs.writeFileSync(path.join(root, "file.txt"), "unstaged\n"); const after = captureTargetSnapshot(root); const comparison = compareTargetSnapshots(before, after); assert.equal(comparison.equal, false); assert.ok(comparison.changed.includes("manifestBytes")); assert.ok(comparison.changed.includes("statusDigest")); assert.ok(comparison.changed.includes("statusClean")); assert.throws(() => assertSemanticIndexInvariant(after), /TARGET_NOT_CLEAN/);
});

for (const [name, mutate] of [
  ["staged addition", (root) => { fs.writeFileSync(path.join(root, "added.txt"), "added\n"); git(root, ["add", "added.txt"], { write: true }); }],
  ["staged modification with a different blob", (root) => { fs.writeFileSync(path.join(root, "file.txt"), "two\n"); git(root, ["add", "file.txt"], { write: true }); }],
  ["staged deletion", (root) => { fs.unlinkSync(path.join(root, "file.txt")); git(root, ["add", "-u"], { write: true }); }],
  ["staged mode change", (root) => { fs.chmodSync(path.join(root, "file.txt"), 0o755); git(root, ["add", "file.txt"], { write: true }); }],
  ["indexed path substitution", (root) => { git(root, ["mv", "file.txt", "replacement.txt"], { write: true }); }],
]) test(`${name} fails semantic preservation`, () => { const root = fixture(`snapshot-${name.replaceAll(" ", "-")}`); const before = captureTargetSnapshot(root); const rawBefore = rawIndexDigest(root); mutate(root); const after = expectSemanticFailure(root); assert.equal(compareTargetSnapshots(before, after).equal, false); assert.notEqual(after.semanticIndex.digest, before.semanticIndex.digest); assert.notEqual(rawIndexDigest(root), rawBefore); });

test("unmerged non-zero index stages are rejected", () => {
  const root = fixture("snapshot-unmerged"); const oid = git(root, ["rev-parse", "HEAD:file.txt"]).stdout.trim(); const zero = "0".repeat(40); git(root, ["update-index", "--index-info"], { write: true, input: `0 ${zero}\tfile.txt\n100644 ${oid} 1\tfile.txt\n100644 ${oid} 2\tfile.txt\n100644 ${oid} 3\tfile.txt\n` }); assert.throws(() => captureTargetSnapshot(root), /GIT_INDEX_UNMERGED_ENTRY/);
});

test("intent-to-add fails semantic preservation", () => {
  const root = fixture("snapshot-intent-to-add"); fs.writeFileSync(path.join(root, "intent.txt"), "intent\n"); git(root, ["add", "-N", "intent.txt"], { write: true }); expectSemanticFailure(root);
});

for (const [name, flag] of [["assume-unchanged", "--assume-unchanged"], ["skip-worktree", "--skip-worktree"]]) test(`${name} index flag fails semantic preservation`, () => {
  const root = fixture(`snapshot-${name}`); git(root, ["update-index", flag, "file.txt"], { write: true }); const snapshot = captureTargetSnapshot(root); assert.equal(snapshot.semanticIndex.ordinaryFlagsOnly, false); assert.throws(() => assertSemanticIndexInvariant(snapshot), /SEMANTIC_INDEX_SPECIAL_FLAGS/);
});
