import assert from "node:assert/strict";
import test from "node:test";
import { authorizeTargetChange } from "../src/paths.mjs";

const change = (path, overrides = {}) => ({ path, operation: "ADD", kind: "regular", executableChanged: false, ...overrides });
test("20 only exact approved namespaces including direct children pass", () => {
  for (const path of ["docs/learning/topic.md", "docs/learning/deep/topic.md", "test/offline/a.test.mjs", "test/fixtures/offline/a.json", "test/fixtures/offline/a.txt", "test/fixtures/offline/a.md"]) assert.equal(authorizeTargetChange(change(path)).allowed, true);
  assert.equal(authorizeTargetChange(change("docs/learning/topic.txt")).allowed, false);
});
test("21 protected paths, traversal, and ambiguous paths are rejected", () => {
  for (const path of ["src/x.mjs", "AGENTS.md", "../docs/learning/x.md", "docs//learning/x.md", ".github/workflows/x.yml"]) assert.equal(authorizeTargetChange(change(path)).allowed, false);
});
test("22 delete, rename, symlink, submodule, and executable changes are rejected", () => {
  for (const candidate of [change("docs/learning/x.md", { operation: "DELETE" }), change("docs/learning/x.md", { operation: "RENAME" }), change("docs/learning/x.md", { kind: "symlink" }), change("docs/learning/x.md", { kind: "submodule" }), change("docs/learning/x.md", { executableChanged: true })]) assert.equal(authorizeTargetChange(candidate).allowed, false);
});
