import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acquireLock, commitReviewBundle, readState, replaceStateAtomic } from "../src/local-store.mjs";

function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), "gov002-durability-")); }
test("16 atomic replacement leaves one complete state", () => {
  const dir = temporary(), file = path.join(dir, "state.json"); replaceStateAtomic(file, { version: 1 }); replaceStateAtomic(file, { version: 2 }); assert.deepEqual(readState(file), { version: 2 }); fs.rmSync(dir, { recursive: true });
});
test("17 two actual processes cannot both acquire one lock", () => {
  const dir = temporary(), lockPath = path.join(dir, "controller.lock"), lock = acquireLock(lockPath, { pid: process.pid });
  const helperPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "helpers", "lock-contender.mjs");
  const child = cp.spawnSync(process.execPath, [helperPath, lockPath]);
  assert.equal(lock.acquired, true); assert.equal(child.status, 2); lock.release(); fs.rmSync(dir, { recursive: true });
});
test("18 lock collision never performs automatic stale takeover", () => {
  const dir = temporary(), lockPath = path.join(dir, "controller.lock"); fs.writeFileSync(lockPath, "stale-looking"); assert.deepEqual(acquireLock(lockPath, { pid: process.pid }), { acquired: false, reason: "LOCKED_NO_STALE_TAKEOVER" }); fs.rmSync(dir, { recursive: true });
});
test("19 persistence fault leaves old complete state and review bundle is atomic", () => {
  const dir = temporary(), file = path.join(dir, "state.json"); replaceStateAtomic(file, { version: 1 }); assert.throws(() => replaceStateAtomic(file, { version: 2 }, { failBeforeRename: true }), /INJECTED/); assert.equal(readState(file).version, 1);
  const base = { iterations: [], summaries: [], outbox: [] }, iteration = { id: "i" }, summary = { id: "s" }, event = { id: "e" }; const next = commitReviewBundle(base, { iteration, summary, event }); assert.deepEqual(next, { iterations: [iteration], summaries: [summary], outbox: [event] }); fs.rmSync(dir, { recursive: true });
});
