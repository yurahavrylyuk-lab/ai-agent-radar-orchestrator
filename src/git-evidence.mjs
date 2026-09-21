import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PHASE2, sha256Canonical } from "./contracts.mjs";

const GIT = "/usr/bin/git";
const SAFE_GIT_ENV = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "/usr/bin/false",
  GIT_SSH_COMMAND: "/usr/bin/false",
  GIT_ALLOW_PROTOCOL: "file",
});

export function git(root, args, { write = false, allowFailure = false, input = undefined, env = {} } = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new TypeError("git arguments must be strings");
  const inherited = { ...process.env };
  for (const key of Object.keys(inherited)) if (["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG_COUNT", "GIT_EXEC_PATH", "GIT_SSH", "GIT_PROXY_COMMAND"].includes(key) || /^GIT_CONFIG_(?:KEY|VALUE)_/u.test(key)) delete inherited[key];
  const result = spawnSync(GIT, ["-C", root, ...args], {
    encoding: "utf8",
    input,
    env: { ...inherited, ...SAFE_GIT_ENV, ...env, GIT_OPTIONAL_LOCKS: write ? "1" : "0" },
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const error = new Error(`GIT_COMMAND_FAILED: git ${args[0]} (${result.status}): ${result.stderr.trim()}`);
    error.code = "GIT_COMMAND_FAILED"; error.status = result.status; throw error;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function resolveCommit(root, revision = "HEAD") {
  const value = git(root, ["rev-parse", "--verify", `${revision}^{commit}`]).stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error("INVALID_COMMIT_ID");
  return value;
}
export function commitMetadata(root, commit) {
  const raw = git(root, ["show", "-s", "--format=%H%n%P%n%T", commit]).stdout.trimEnd().split("\n");
  return { commit: raw[0], parents: raw[1] ? raw[1].split(" ") : [], tree: raw[2] };
}
export function currentBranch(root) { return git(root, ["symbolic-ref", "--short", "HEAD"]).stdout.trim(); }
export function statusPorcelain(root, { includeIgnored = false } = {}) { return git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", ...(includeIgnored ? ["--ignored"] : [])]).stdout; }
export function remotes(root) { return git(root, ["remote"]).stdout.trim().split("\n").filter(Boolean); }
export function alternates(root) {
  const common = git(root, ["rev-parse", "--git-common-dir"]).stdout.trim();
  const location = path.resolve(root, common, "objects/info/alternates");
  return fs.existsSync(location) ? fs.readFileSync(location, "utf8") : "";
}
export function changedFiles(root, from, to) {
  const output = git(root, ["diff", "--raw", "-z", "--no-renames", from, to]).stdout;
  const fields = output.split("\0").filter(Boolean); const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const header = fields[index]; const file = fields[index + 1];
    const match = header.match(/^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])$/u);
    if (!match || file === undefined) throw new Error("UNPARSEABLE_GIT_DIFF");
    changes.push({ path: file, oldMode: match[1], newMode: match[2], oldObject: match[3], newObject: match[4], status: match[5] });
  }
  return changes;
}
export function verifyPilotCandidate({ root, candidateCommit, expectedParent, baselineCommit, previousCandidate = null }) {
  if (remotes(root).length !== 0) throw new Error("WORKSPACE_REMOTE_PRESENT");
  if (alternates(root)) throw new Error("WORKSPACE_ALTERNATES_PRESENT");
  if (statusPorcelain(root, { includeIgnored: true }) !== "") throw new Error("WORKSPACE_NOT_CLEAN");
  const metadata = commitMetadata(root, candidateCommit);
  if (metadata.parents.length !== 1 || metadata.parents[0] !== expectedParent) throw new Error("NONLINEAR_OR_WRONG_PARENT");
  if (previousCandidate !== null && expectedParent !== previousCandidate) throw new Error("CORRECTIVE_PARENT_MISMATCH");
  const perIteration = changedFiles(root, expectedParent, candidateCommit);
  const cumulative = changedFiles(root, baselineCommit, candidateCommit);
  if (perIteration.length !== 1 || perIteration[0].path !== PHASE2.pilotPath || !["A", "M"].includes(perIteration[0].status)) throw new Error("ITERATION_SCOPE_VIOLATION");
  if (perIteration[0].oldMode !== (perIteration[0].status === "A" ? "000000" : "100644") || perIteration[0].newMode !== "100644") throw new Error("ITERATION_MODE_VIOLATION");
  if (cumulative.length !== 1 || cumulative[0].path !== PHASE2.pilotPath || cumulative[0].status !== "A" || cumulative[0].oldMode !== "000000" || cumulative[0].newMode !== "100644") throw new Error("CUMULATIVE_SCOPE_VIOLATION");
  const filePath = path.join(root, PHASE2.pilotPath); const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) !== 0) throw new Error("PILOT_FILE_TYPE_OR_MODE_VIOLATION");
  validatePilotContent(fs.readFileSync(filePath, "utf8"));
  return { ...metadata, perIteration, cumulative, scopeDigest: sha256Canonical(cumulative) };
}

export function validatePilotContent(content) {
  if (typeof content !== "string" || content.includes("\0")) throw new Error("PILOT_CONTENT_INVALID");
  const words = content.trim().split(/\s+/u).filter(Boolean); if (words.length > 800) throw new Error("PILOT_WORD_LIMIT_VIOLATION");
  if (!/(?:fictional|offline)/iu.test(content)) throw new Error("PILOT_OFFLINE_LABEL_REQUIRED");
  if (/(?:api[_ -]?key|secret|credential|cloudflare|wrangler|resend|\bd1\b|billing|deploy(?:ment)?|production command)/iu.test(content)) throw new Error("PILOT_PROHIBITED_CONTENT");
  return { wordCount: words.length, automatedConstraintsOnly: true };
}

export const SAFE_GIT_ENVIRONMENT = SAFE_GIT_ENV;
