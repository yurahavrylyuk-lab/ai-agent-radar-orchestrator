import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256Canonical } from "./contracts.mjs";

export const PRODUCTION_AUTHORITY_ROOT = "/Users/yuriy/Library/Application Support/AI Agent Radar Orchestrator/authority";
export const PROTECTED_REAL_TARGET_ROOT = "/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent";
export const DISPOSABLE_AUTHORITY_TEST_FLAG = "GOV002_TEST_DISPOSABLE_AUTHORITY";

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

export function roleSandboxProfile({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot }) {
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    `(deny file-read* file-write* (subpath ${quote(path.resolve(authorityRoot))}))`,
    `(deny file-write* (subpath ${quote(path.resolve(controllerRoot))}))`,
    `(deny file-write* (subpath ${quote(path.resolve(targetRoot))}))`,
    `(allow file-write* (subpath ${quote(path.resolve(roleOutputRoot))}))`,
  ].join(" ");
  return Object.freeze({ profile, digest: sha256Canonical({ profile }) });
}

export function verifyDisposableConfinement({ now = new Date().toISOString() } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gov002-role-boundary-"));
  const authorityRoot = path.join(root, "authority");
  const controllerRoot = path.join(root, "controller");
  const targetRoot = path.join(root, "target");
  const roleOutputRoot = path.join(root, "role-output");
  for (const item of [authorityRoot, controllerRoot, targetRoot, roleOutputRoot]) fs.mkdirSync(item, { mode: 0o700 });
  fs.writeFileSync(path.join(authorityRoot, "sentinel"), "authority\n", { mode: 0o600 });
  const policy = roleSandboxProfile({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot });
  const source = [
    'const fs = require("node:fs"); const path = require("node:path"); const { spawnSync } = require("node:child_process");',
    'function denied(root, name) { try { fs.writeFileSync(path.join(root, name), "forbidden"); return false; } catch (error) { return ["EPERM", "EACCES"].includes(error.code); } }',
    'let readDenied = false; try { fs.readFileSync(path.join(process.env.AUTHORITY_ROOT, "sentinel")); } catch (error) { readDenied = ["EPERM", "EACCES"].includes(error.code); }',
    'if (!readDenied || !denied(process.env.AUTHORITY_ROOT, "direct") || !denied(process.env.CONTROLLER_ROOT, "direct") || !denied(process.env.TARGET_ROOT, "direct")) process.exit(71);',
    'fs.writeFileSync(path.join(process.env.ROLE_OUTPUT_ROOT, "allowed"), "ok");',
    'const child = spawnSync(process.execPath, ["-e", "const fs=require(\\\"node:fs\\\");const path=require(\\\"node:path\\\");let n=0;for(const r of [process.env.AUTHORITY_ROOT,process.env.CONTROLLER_ROOT,process.env.TARGET_ROOT]){try{fs.writeFileSync(path.join(r,\\\"child\\\"),\\\"x\\\")}catch(e){if([\\\"EPERM\\\",\\\"EACCES\\\"].includes(e.code))n++}}process.exit(n===3?0:72)"], { env: process.env });',
    'process.exit(child.status === 0 ? 0 : 73);',
  ].join("\n");
  const result = spawnSync("/usr/bin/sandbox-exec", ["-p", policy.profile, "/usr/local/bin/node", "-e", source], {
    env: { ...process.env, AUTHORITY_ROOT: authorityRoot, CONTROLLER_ROOT: controllerRoot, TARGET_ROOT: targetRoot, ROLE_OUTPUT_ROOT: roleOutputRoot },
    encoding: "utf8",
  });
  const passed = result.status === 0 && fs.existsSync(path.join(roleOutputRoot, "allowed")) && ![authorityRoot, controllerRoot, targetRoot].some((item) => fs.existsSync(path.join(item, "direct")) || fs.existsSync(path.join(item, "child")));
  fs.rmSync(root, { recursive: true, force: true });
  if (!passed) throw new Error(`ROLE_FILESYSTEM_CONFINEMENT_UNAVAILABLE:${result.status}:${result.stderr.trim()}`);
  return Object.freeze({ schemaVersion: 1, mechanism: "MACOS_SANDBOX_EXEC", policyDigest: policy.digest, networkDenied: true, authorityReadDenied: true, authorityWriteDenied: true, controllerWriteDenied: true, targetWriteDenied: true, descendantsDenied: true, verifiedAt: now });
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
