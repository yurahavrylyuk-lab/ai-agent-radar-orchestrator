import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acquireLock, PersistenceDurabilityUncertainError, readState, replaceStateAtomic } from "../src/local-store.mjs";

function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), "gov002-durability-")); }
test("16 atomic replacement leaves one complete state", () => {
  const dir = temporary(), file = path.join(dir, "state.json"), operations = [], descriptors = [];
  replaceStateAtomic(file, { version: 1 }, { onOperation(name, fd) { operations.push(name); if (name.endsWith("close")) descriptors.push(fd); } });
  assert.deepEqual(operations, ["temporary-open", "temporary-write", "temporary-sync", "temporary-close", "rename", "directory-open", "directory-sync", "directory-close"]);
  for (const fd of descriptors) assert.throws(() => fs.fstatSync(fd), { code: "EBADF" });
  replaceStateAtomic(file, { version: 2 }); assert.deepEqual(readState(file), { version: 2 }); fs.rmSync(dir, { recursive: true });
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
  const dir = temporary(), file = path.join(dir, "state.json"); replaceStateAtomic(file, { version: 1 }); const before = fs.readFileSync(file);
  assert.throws(() => replaceStateAtomic(file, { version: 2 }, { failBeforeRename: true }), /BEFORE_RENAME/); assert.deepEqual(fs.readFileSync(file), before); assert.equal(readState(file).version, 1);
  assert.equal(fs.readdirSync(dir).filter((name) => name.includes(".tmp-")).length, 0); fs.rmSync(dir, { recursive: true });
});
test("38 post-rename directory-sync failure is explicit durability uncertainty", () => {
  const dir = temporary(), file = path.join(dir, "state.json"), closed = [];
  replaceStateAtomic(file, { version: 1 });
  assert.throws(() => replaceStateAtomic(file, { version: 2 }, { failAfterRename: true, onOperation(name, fd) { if (name.endsWith("close")) closed.push(fd); } }), (error) => error instanceof PersistenceDurabilityUncertainError && error.stateVisible === true);
  assert.equal(readState(file).version, 2); for (const fd of closed) assert.throws(() => fs.fstatSync(fd), { code: "EBADF" }); fs.rmSync(dir, { recursive: true });
});
test("39 lock release refuses to remove a replacement lock it does not own", () => {
  const dir = temporary(), lockPath = path.join(dir, "controller.lock"), lock = acquireLock(lockPath, { pid: process.pid });
  fs.unlinkSync(lockPath); fs.writeFileSync(lockPath, JSON.stringify({ lockToken: "other" }));
  assert.throws(() => lock.release(), /LOCK_OWNERSHIP_LOST/); assert.equal(fs.existsSync(lockPath), true); fs.rmSync(dir, { recursive: true });
});
