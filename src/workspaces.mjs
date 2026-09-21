import fs from "node:fs";
import path from "node:path";
import { git, alternates, remotes } from "./git-evidence.mjs";

function contained(root, candidate) {
  const relative = path.relative(root, candidate); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function createIndependentWorkspace({ sourceRoot, runtimeRoot, workspaceId, commit, role }) {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(workspaceId)) throw new Error("INVALID_WORKSPACE_ID");
  if (!['architect', 'builder', 'analyst'].includes(role)) throw new Error("INVALID_WORKSPACE_ROLE");
  const canonicalRuntime = fs.realpathSync(runtimeRoot); const workspaceRoot = path.join(canonicalRuntime, "workspaces", workspaceId);
  if (!contained(canonicalRuntime, workspaceRoot) || fs.existsSync(workspaceRoot)) throw new Error("WORKSPACE_PATH_NOT_AVAILABLE");
  fs.mkdirSync(path.dirname(workspaceRoot), { recursive: true });
  git(canonicalRuntime, ["clone", "--no-local", "--no-hardlinks", "--no-checkout", fs.realpathSync(sourceRoot), workspaceRoot], { write: true });
  git(workspaceRoot, ["remote", "remove", "origin"], { write: true });
  const hooks = path.join(canonicalRuntime, "empty-hooks"); fs.mkdirSync(hooks, { recursive: true });
  git(workspaceRoot, ["config", "core.hooksPath", hooks], { write: true });
  git(workspaceRoot, ["config", "credential.helper", ""], { write: true });
  git(workspaceRoot, ["config", "protocol.file.allow", "always"], { write: true });
  git(workspaceRoot, ["checkout", "--detach", commit], { write: true });
  if (remotes(workspaceRoot).length || alternates(workspaceRoot)) throw new Error("WORKSPACE_NOT_INDEPENDENT");
  return Object.freeze({ workspaceId, role, root: fs.realpathSync(workspaceRoot), expectedCommit: commit, registeredAt: new Date().toISOString() });
}

export function resolveRegisteredWorkspace(record, expectedRole = null) {
  if (!record || typeof record.root !== "string") throw new Error("UNREGISTERED_WORKSPACE");
  const root = fs.realpathSync(record.root);
  if (root !== record.root) throw new Error("SUBSTITUTED_WORKSPACE_ROOT");
  const stat = fs.lstatSync(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("INVALID_WORKSPACE_ROOT");
  if (expectedRole !== null && record.role !== expectedRole) throw new Error("WRONG_WORKSPACE_ROLE");
  if (remotes(root).length || alternates(root)) throw new Error("WORKSPACE_TRANSPORT_PRESENT");
  return root;
}
