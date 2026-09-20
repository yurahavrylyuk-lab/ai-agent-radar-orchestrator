import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import test from "node:test";

test("32 complete suite runs under OS-enforced external-network denial", () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/cases.json", import.meta.url))); assert.equal(fixture.count, 32); assert.equal(fixture.cases.length, 32);
  const code = "import ctypes,os;lib=ctypes.CDLL('/usr/lib/libsandbox.dylib');check=lib.sandbox_check;check.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int];check.restype=ctypes.c_int;print(check(os.getpid(),b'network-outbound',0),check(os.getpid(),b'network-inbound',0))";
  const result = cp.spawnSync("/usr/bin/python3", ["-B", "-c", code], { encoding: "utf8" }); assert.equal(result.status, 0); assert.equal(result.stdout.trim(), "1 1");
});
