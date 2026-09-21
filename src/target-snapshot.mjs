import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { git } from "./git-evidence.mjs";

function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function zeroPaths(value) { return value.split("\0").filter(Boolean); }

export function captureTargetSnapshot(root) {
  const canonicalRoot = fs.realpathSync(root);
  const files = [...new Set(zeroPaths(git(canonicalRoot, ["ls-files", "-co", "--exclude-standard", "-z"]).stdout))].sort();
  const manifest = []; const modes = [];
  for (const relative of files) {
    const absolute = path.join(canonicalRoot, relative); const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`UNSUPPORTED_TARGET_ENTRY:${relative}`);
    manifest.push({ path: relative, sha256: hash(fs.readFileSync(absolute)) });
    modes.push({ path: relative, mode: (stat.mode & 0o7777).toString(8).padStart(4, "0") });
  }
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  const modesBytes = `${JSON.stringify(modes, null, 2)}\n`;
  const gitDirectory = path.resolve(canonicalRoot, git(canonicalRoot, ["rev-parse", "--git-dir"]).stdout.trim());
  const config = path.join(gitDirectory, "config"); const index = path.join(gitDirectory, "index");
  const refs = git(canonicalRoot, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags", "refs/remotes"]).stdout;
  return {
    root: canonicalRoot,
    symbolicHead: git(canonicalRoot, ["symbolic-ref", "HEAD"]).stdout.trim(),
    branch: git(canonicalRoot, ["branch", "--show-current"]).stdout.trim(),
    refs,
    status: git(canonicalRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout,
    manifest, manifestBytes, manifestDigest: hash(manifestBytes),
    modes, modesBytes, modesDigest: hash(modesBytes),
    configDigest: hash(fs.readFileSync(config)), indexDigest: hash(fs.readFileSync(index)),
  };
}

export function compareTargetSnapshots(before, after) {
  const fields = ["root", "symbolicHead", "branch", "refs", "status", "manifestBytes", "manifestDigest", "modesBytes", "modesDigest", "configDigest", "indexDigest"];
  const changed = fields.filter((field) => before[field] !== after[field]);
  return { equal: changed.length === 0, changed };
}
