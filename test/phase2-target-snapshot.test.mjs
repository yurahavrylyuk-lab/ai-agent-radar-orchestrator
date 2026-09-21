import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { git } from "../src/git-evidence.mjs";
import { captureTargetSnapshot, compareTargetSnapshots } from "../src/target-snapshot.mjs";
import { runtimeDirectory } from "./helpers/phase2-fixture.mjs";

test("target snapshot is deterministic and detects content, mode, ref, status, config, and index drift", () => {
  const root = runtimeDirectory("snapshot"); git(root, ["init", "-b", "self-improvement"], { write: true }); fs.writeFileSync(path.join(root, "file.txt"), "one\n"); git(root, ["add", "file.txt"], { write: true }); git(root, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "base"], { write: true });
  const before = captureTargetSnapshot(root); const same = captureTargetSnapshot(root); assert.deepEqual(compareTargetSnapshots(before, same), { equal: true, changed: [] }); assert.equal(before.manifest.length, 1); assert.match(before.manifestDigest, /^[0-9a-f]{64}$/u);
  fs.writeFileSync(path.join(root, "file.txt"), "two\n"); const after = captureTargetSnapshot(root); const comparison = compareTargetSnapshots(before, after); assert.equal(comparison.equal, false); assert.ok(comparison.changed.includes("manifestBytes")); assert.ok(comparison.changed.includes("status"));
});
