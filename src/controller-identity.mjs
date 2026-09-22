import fs from "node:fs";
import path from "node:path";
import { commitMetadata, git, statusPorcelain } from "./git-evidence.mjs";
import { APPROVED_CONTROLLER_ORIGIN, verifyControllerRemotePolicy } from "./controller-remote-policy.mjs";

export function inspectControllerIdentity(root, { expectedCommit = null, requirePublished = true } = {}) {
  const canonicalRoot = fs.realpathSync(root);
  if (canonicalRoot !== path.resolve(root)) throw new Error("CONTROLLER_ROOT_NOT_CANONICAL");
  const gitDirectory = fs.realpathSync(path.resolve(canonicalRoot, git(canonicalRoot, ["rev-parse", "--git-dir"]).stdout.trim()));
  if (statusPorcelain(canonicalRoot) !== "") throw new Error("CONTROLLER_NOT_CLEAN");
  const remote = verifyControllerRemotePolicy(canonicalRoot, { expectedCommit, requirePublished });
  const metadata = commitMetadata(canonicalRoot, remote.head);
  return Object.freeze({
    canonicalRoot,
    gitDirectory,
    commit: metadata.commit,
    tree: metadata.tree,
    approvedOrigin: APPROVED_CONTROLLER_ORIGIN,
    upstream: remote.upstream,
  });
}

export function verifyBoundControllerIdentity(bound, root) {
  const current = inspectControllerIdentity(root, { expectedCommit: bound.commit, requirePublished: true });
  for (const field of ["canonicalRoot", "commit", "tree", "approvedOrigin"]) {
    if (current[field] !== bound[field]) throw new Error(`CONTROLLER_${field.toUpperCase()}_MISMATCH`);
  }
  return current;
}
