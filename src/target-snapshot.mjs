import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { git, inspectGit } from "./git-evidence.mjs";

export const SEMANTIC_INDEX_FORMAT = "git-index-semantic-v1";

function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function zeroPaths(value) { return value.split("\0").filter(Boolean); }

function nulRecords(bytes) {
  const records = []; let start = 0;
  for (let index = 0; index < bytes.length; index += 1) if (bytes[index] === 0) { if (index > start) records.push(bytes.subarray(start, index)); start = index + 1; }
  if (start !== bytes.length) throw new Error("GIT_NUL_OUTPUT_UNTERMINATED");
  return records;
}

function splitHeader(record) {
  const tab = record.indexOf(9); if (tab === -1) throw new Error("GIT_INDEX_RECORD_MALFORMED");
  return { header: record.subarray(0, tab).toString("ascii"), path: Buffer.from(record.subarray(tab + 1)) };
}

function normalizedIndexEntries(bytes) {
  const entries = nulRecords(bytes).map((record) => {
    const { header, path: rawPath } = splitHeader(record); const match = header.match(/^([0-7]{6}) ([0-9a-f]{40,64}) ([0-3])$/u);
    if (!match) throw new Error("GIT_INDEX_RECORD_MALFORMED");
    const stage = Number(match[3]); if (stage !== 0) throw new Error("GIT_INDEX_UNMERGED_ENTRY");
    return { rawPath, value: { pathBase64: rawPath.toString("base64"), mode: match[1], oid: match[2], stage } };
  });
  entries.sort((left, right) => Buffer.compare(left.rawPath, right.rawPath));
  for (let index = 1; index < entries.length; index += 1) if (Buffer.compare(entries[index - 1].rawPath, entries[index].rawPath) === 0) throw new Error("GIT_INDEX_DUPLICATE_PATH");
  return entries.map((entry) => entry.value);
}

function normalizedTreeEntries(bytes) {
  const entries = nulRecords(bytes).map((record) => {
    const { header, path: rawPath } = splitHeader(record); const match = header.match(/^([0-7]{6}) (?:blob|commit) ([0-9a-f]{40,64})$/u);
    if (!match) throw new Error("GIT_TREE_RECORD_MALFORMED");
    return { rawPath, value: { pathBase64: rawPath.toString("base64"), mode: match[1], oid: match[2], stage: 0 } };
  });
  entries.sort((left, right) => Buffer.compare(left.rawPath, right.rawPath));
  for (let index = 1; index < entries.length; index += 1) if (Buffer.compare(entries[index - 1].rawPath, entries[index].rawPath) === 0) throw new Error("GIT_TREE_DUPLICATE_PATH");
  return entries.map((entry) => entry.value);
}

function semanticBytes(entries) { return Buffer.from(`${JSON.stringify({ format: SEMANTIC_INDEX_FORMAT, entries })}\n`, "utf8"); }

function ordinaryIndexFlags(bytes, indexEntries) {
  const records = nulRecords(bytes); if (records.length !== indexEntries.length) return false;
  const paths = records.map((record) => { if (record.length < 3 || record[0] !== 72 || record[1] !== 32) return null; return record.subarray(2).toString("base64"); });
  return paths.every((value) => value !== null) && paths.sort().join("\0") === indexEntries.map((entry) => entry.pathBase64).sort().join("\0");
}

export function captureSemanticIndex(root) {
  const indexEntries = normalizedIndexEntries(inspectGit(root, ["ls-files", "--stage", "--full-name", "-z"]).stdout);
  const treeEntries = normalizedTreeEntries(inspectGit(root, ["ls-tree", "-r", "--full-tree", "-z", "HEAD"]).stdout);
  const serialized = semanticBytes(indexEntries); const headSerialized = semanticBytes(treeEntries);
  const cached = inspectGit(root, ["diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", "--ita-visible-in-index", "--ignore-submodules=none", "HEAD", "--"], { allowFailure: true });
  if (![0, 1].includes(cached.status)) throw new Error("GIT_CACHED_DIFF_INSPECTION_FAILED");
  return {
    format: SEMANTIC_INDEX_FORMAT,
    digest: hash(serialized),
    entryCount: indexEntries.length,
    equalsHeadTree: serialized.equals(headSerialized),
    ordinaryFlagsOnly: ordinaryIndexFlags(inspectGit(root, ["ls-files", "-v", "--full-name", "-z"]).stdout, indexEntries),
    cachedDiffEmpty: cached.status === 0,
    serialized,
    entries: indexEntries,
  };
}

export function assertSemanticIndexInvariant(snapshot) {
  if (snapshot.semanticIndex.format !== SEMANTIC_INDEX_FORMAT) throw new Error("SEMANTIC_INDEX_FORMAT_INCOMPATIBLE");
  if (!snapshot.semanticIndex.equalsHeadTree) throw new Error("SEMANTIC_INDEX_HEAD_MISMATCH");
  if (!snapshot.semanticIndex.ordinaryFlagsOnly) throw new Error("SEMANTIC_INDEX_SPECIAL_FLAGS");
  if (!snapshot.semanticIndex.cachedDiffEmpty) throw new Error("SEMANTIC_INDEX_STAGED_DIFF");
  if (snapshot.statusDigest !== hash(Buffer.alloc(0))) throw new Error("TARGET_NOT_CLEAN");
  return true;
}

export function captureTargetSnapshot(root) {
  const canonicalRoot = fs.realpathSync(root);
  const head = inspectGit(canonicalRoot, ["rev-parse", "HEAD"]).stdout.toString("ascii").trim(); if (!/^[0-9a-f]{40,64}$/u.test(head)) throw new Error("TARGET_HEAD_INVALID");
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
  const gitDirectory = fs.realpathSync(path.resolve(canonicalRoot, git(canonicalRoot, ["rev-parse", "--git-dir"]).stdout.trim())); const gitDirectoryStat = fs.lstatSync(gitDirectory);
  const config = path.join(gitDirectory, "config"); const index = path.join(gitDirectory, "index");
  const refs = git(canonicalRoot, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags", "refs/remotes"]).stdout;
  const semanticIndex = captureSemanticIndex(canonicalRoot);
  const statusBytes = inspectGit(canonicalRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]).stdout;
  return {
    root: canonicalRoot,
    head,
    symbolicHead: git(canonicalRoot, ["symbolic-ref", "HEAD"]).stdout.trim(),
    branch: git(canonicalRoot, ["branch", "--show-current"]).stdout.trim(),
    refs,
    statusDigest: hash(statusBytes),
    manifest, manifestBytes, manifestDigest: hash(manifestBytes),
    modes, modesBytes, modesDigest: hash(modesBytes),
    configDigest: hash(fs.readFileSync(config)), rawIndexDigestDiagnostic: hash(fs.readFileSync(index)),
    gitDirectoryIdentity: { canonicalPath: gitDirectory, device: gitDirectoryStat.dev, inode: gitDirectoryStat.ino },
    semanticIndex: { format: semanticIndex.format, digest: semanticIndex.digest, entryCount: semanticIndex.entryCount, equalsHeadTree: semanticIndex.equalsHeadTree, ordinaryFlagsOnly: semanticIndex.ordinaryFlagsOnly, cachedDiffEmpty: semanticIndex.cachedDiffEmpty },
  };
}

export function compareTargetSnapshots(before, after) {
  const fields = ["root", "head", "symbolicHead", "branch", "refs", "statusDigest", "manifestBytes", "manifestDigest", "modesBytes", "modesDigest", "configDigest"];
  const changed = fields.filter((field) => before[field] !== after[field]);
  if (JSON.stringify(before.gitDirectoryIdentity) !== JSON.stringify(after.gitDirectoryIdentity)) changed.push("gitDirectoryIdentity");
  if (after.statusDigest !== hash(Buffer.alloc(0))) changed.push("statusClean");
  if (before.semanticIndex.format !== after.semanticIndex.format || before.semanticIndex.digest !== after.semanticIndex.digest || before.semanticIndex.entryCount !== after.semanticIndex.entryCount || !after.semanticIndex.equalsHeadTree || !after.semanticIndex.ordinaryFlagsOnly || !after.semanticIndex.cachedDiffEmpty) changed.push("semanticIndex");
  return { equal: changed.length === 0, changed };
}
