import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { roleSandboxProfile } from "../src/operator-boundary.mjs";

test("activation role policy combines network denial with authority, controller, and target confinement", () => {
  const value = roleSandboxProfile({ authorityRoot: "/private/tmp/a", controllerRoot: "/private/tmp/c", targetRoot: "/private/tmp/t", roleOutputRoot: "/private/tmp/o" });
  assert.match(value.profile, /deny network\*/u); assert.match(value.profile, /deny file-read\* file-write\*/u); assert.match(value.profile, /\/private\/tmp\/a/u); assert.match(value.profile, /\/private\/tmp\/c/u); assert.match(value.profile, /\/private\/tmp\/t/u); assert.match(value.profile, /allow file-write\*/u); assert.match(value.digest, /^[0-9a-f]{64}$/u);
});

test("mandatory wrapper supplied native direct and descendant filesystem-denial evidence", () => {
  assert.equal(process.env.GOV002_FS_BOUNDARY_PROVED, "MACOS_SANDBOX_EXEC_DIRECT_AND_DESCENDANT_DENIAL");
});

test("activation runtime has no provider, publication, scheduling, or automatic role-launch adapter", () => {
  const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
  const files = fs.readdirSync(sourceRoot).filter((name) => name.endsWith(".mjs"));
  const activationFiles = files.filter((name) => /^(?:pilot-authorization|operator-boundary|controller-identity|controller-remote-policy|real-pilot-admission|real-local-integration|cli)\.mjs$/u.test(name));
  const source = activationFiles.map((name) => fs.readFileSync(path.join(sourceRoot, name), "utf8")).join("\n");
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
  assert.doesNotMatch(source, /\b(?:Brave|Gemini|OpenAI|Resend)\b/u);
  assert.doesNotMatch(source, /\[\s*["']push["']/u);
  assert.doesNotMatch(source, /\b(?:cron|scheduled\s*\()/iu);
  assert.doesNotMatch(source, /\b(?:codex|cursor)\s+(?:exec|agent|run)\b/iu);
});
