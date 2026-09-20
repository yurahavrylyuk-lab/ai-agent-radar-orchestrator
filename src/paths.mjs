import path from "node:path";

const exactNamespaces = [
  { root: "docs/learning", ext: [".md"] },
  { root: "test/offline", ext: [".test.mjs"] },
  { root: "test/fixtures/offline", ext: [".json", ".txt", ".md"] },
];
const protectedPrefixes = [".git", ".github", "src", "config", "schemas", "scripts", "migrations", "node_modules"];
const protectedNames = new Set(["AGENTS.md", "package.json", "package-lock.json", "wrangler.jsonc", ".env", ".dev.vars"]);

export function normalizeTargetPath(input) {
  if (typeof input !== "string" || !input || input.includes("\0") || input.includes("\\")) throw new Error("AMBIGUOUS_PATH");
  if (path.posix.isAbsolute(input) || input.split("/").includes("..") || input.split("/").includes(".")) throw new Error("PATH_TRAVERSAL");
  const normalized = path.posix.normalize(input);
  if (normalized !== input || normalized.startsWith("../")) throw new Error("AMBIGUOUS_PATH");
  return normalized;
}
export function authorizeTargetChange(change) {
  const allowedFields = ["path", "operation", "kind", "executableChanged"];
  if (!change || Object.keys(change).some((key) => !allowedFields.includes(key))) return { allowed: false, reason: "INVALID_CHANGE" };
  let candidate; try { candidate = normalizeTargetPath(change.path); } catch (error) { return { allowed: false, reason: error.message }; }
  if (!["ADD", "MODIFY"].includes(change.operation)) return { allowed: false, reason: "PROHIBITED_OPERATION" };
  if (change.kind !== "regular" || change.executableChanged) return { allowed: false, reason: "PROHIBITED_FILESYSTEM_TYPE" };
  if (protectedNames.has(candidate) || protectedPrefixes.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix}/`))) return { allowed: false, reason: "PROTECTED_PATH" };
  const rule = exactNamespaces.find(({ root, ext }) => (candidate.startsWith(`${root}/`) && candidate.length > root.length + 1) && ext.some((suffix) => candidate.endsWith(suffix)));
  return rule ? { allowed: true, reason: "ALLOWLIST_MATCH" } : { allowed: false, reason: "PATH_NOT_ALLOWED" };
}
