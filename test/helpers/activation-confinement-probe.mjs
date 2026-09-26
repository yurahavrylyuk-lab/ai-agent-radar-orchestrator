import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots = { authority: process.env.AUTHORITY_ROOT, controller: process.env.CONTROLLER_ROOT, target: process.env.TARGET_ROOT };
assert.equal([...Object.values(roots), process.env.ROLE_OUTPUT_ROOT].every(Boolean), true);
const probe = (operation, action, allowed = false) => {
  try {
    action();
    return { operation, result: allowed ? "ALLOWED" : "ALLOWED_FORBIDDEN", errorCode: null };
  } catch (error) {
    return { operation, result: ["EPERM", "EACCES"].includes(error.code) ? "DENIED" : "UNEXPECTED_ERROR", errorCode: error.code ?? null };
  }
};
const direct = [
  probe("authority-read", () => fs.readFileSync(path.join(roots.authority, "sentinel"))),
  probe("authority-write", () => fs.writeFileSync(path.join(roots.authority, "direct-write"), "forbidden")),
  probe("controller-write", () => fs.writeFileSync(path.join(roots.controller, "direct-write"), "forbidden")),
  probe("target-write", () => fs.writeFileSync(path.join(roots.target, "direct-write"), "forbidden")),
  probe("role-output-write", () => fs.writeFileSync(path.join(process.env.ROLE_OUTPUT_ROOT, "allowed-result"), "allowed\n"), true),
];
assert.deepEqual(direct.map(({ operation, result }) => [operation, result]), [["authority-read", "DENIED"], ["authority-write", "DENIED"], ["controller-write", "DENIED"], ["target-write", "DENIED"], ["role-output-write", "ALLOWED"]]);
const childSource = [
  'const fs = require("node:fs"); const path = require("node:path");',
  'const probe=(operation,action)=>{try{action();return{operation,result:"ALLOWED_FORBIDDEN",errorCode:null}}catch(error){return{operation,result:["EPERM","EACCES"].includes(error.code)?"DENIED":"UNEXPECTED_ERROR",errorCode:error.code??null}}};',
  'const result=[probe("descendant-authority-read",()=>fs.readFileSync(path.join(process.env.AUTHORITY_ROOT,"sentinel"))),probe("descendant-authority-write",()=>fs.writeFileSync(path.join(process.env.AUTHORITY_ROOT,"child-write"),"forbidden")),probe("descendant-controller-write",()=>fs.writeFileSync(path.join(process.env.CONTROLLER_ROOT,"child-write"),"forbidden")),probe("descendant-target-write",()=>fs.writeFileSync(path.join(process.env.TARGET_ROOT,"child-write"),"forbidden"))];',
  'process.stdout.write(JSON.stringify(result));',
].join("\n");
const child = spawnSync(process.execPath, ["-e", childSource], { env: process.env, encoding: "utf8" });
assert.equal(child.status, 0, child.stderr);
const descendant = JSON.parse(child.stdout);
assert.deepEqual(descendant.map(({ operation, result }) => [operation, result]), [["descendant-authority-read", "DENIED"], ["descendant-authority-write", "DENIED"], ["descendant-controller-write", "DENIED"], ["descendant-target-write", "DENIED"]]);
const networkProbe = spawnSync("/usr/bin/python3", ["-B", "-c", `
import ctypes, os
lib = ctypes.CDLL("/usr/lib/libsandbox.dylib")
check = lib.sandbox_check
check.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
check.restype = ctypes.c_int
values = [check(os.getpid(), name.encode(), 0) for name in ("network-outbound", "network-inbound")]
raise SystemExit(0 if values == [1, 1] else 72)
`], { encoding: "utf8" });
assert.equal(networkProbe.status, 0, networkProbe.stderr);
process.stdout.write(`ACTIVATION_FILESYSTEM_BOUNDARY ${JSON.stringify({ direct, descendant, childExitStatus: child.status, networkInbound: "DENIED", networkOutbound: "DENIED" })}\n`);
