import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots = [process.env.AUTHORITY_ROOT, process.env.CONTROLLER_ROOT, process.env.TARGET_ROOT];
assert.equal(roots.every(Boolean), true);
let authorityReadDenied = false;
try { fs.readFileSync(path.join(process.env.AUTHORITY_ROOT, "sentinel")); } catch (error) { authorityReadDenied = ["EPERM", "EACCES"].includes(error.code); }
assert.equal(authorityReadDenied, true);
for (const root of roots) assert.throws(() => fs.writeFileSync(path.join(root, "direct-write"), "forbidden"), (error) => ["EPERM", "EACCES"].includes(error.code));
fs.writeFileSync(path.join(process.env.ROLE_OUTPUT_ROOT, "allowed-result"), "allowed\n");
const childSource = [
  'const fs = require("node:fs"); const path = require("node:path"); let denied = 0;',
  'for (const root of [process.env.AUTHORITY_ROOT, process.env.CONTROLLER_ROOT, process.env.TARGET_ROOT]) { try { fs.writeFileSync(path.join(root, "child-write"), "forbidden"); } catch (error) { if (["EPERM", "EACCES"].includes(error.code)) denied += 1; } }',
  'process.exit(denied === 3 ? 0 : 71);',
].join("\n");
const child = spawnSync(process.execPath, ["-e", childSource], { env: process.env, encoding: "utf8" }); assert.equal(child.status, 0, child.stderr);
const networkProbe = spawnSync("/usr/bin/python3", ["-B", "-c", `
import ctypes, os
lib = ctypes.CDLL("/usr/lib/libsandbox.dylib")
check = lib.sandbox_check
check.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
check.restype = ctypes.c_int
values = [check(os.getpid(), name.encode(), 0) for name in ("network-outbound", "network-inbound")]
raise SystemExit(0 if values == [1, 1] else 72)
`], { encoding: "utf8" }); assert.equal(networkProbe.status, 0, networkProbe.stderr);
process.stdout.write("ACTIVATION_FILESYSTEM_BOUNDARY direct=denied descendant=denied authority-read=denied network-inbound=denied network-outbound=denied\n");
