#!/usr/local/bin/node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createExecutionFrame, decodeExecutionFrame, encodeExecutionFrame, EXECUTOR_EVENT_TYPES } from "./role-execution-protocol.mjs";

const PILOT_PATH = "docs/learning/offline-fixture-reading.md";

function identity(root) {
  const canonicalPath = fs.realpathSync(root); const stat = fs.lstatSync(canonicalPath);
  return { canonicalPath, type: stat.isDirectory() ? "directory" : "other", device: stat.dev, inode: stat.ino, ownerUid: stat.uid, mode: (stat.mode & 0o7777).toString(8).padStart(4, "0") };
}

function executableIdentity() {
  const canonicalPath = fs.realpathSync(process.execPath); const stat = fs.lstatSync(canonicalPath);
  return { canonicalPath, device: stat.dev, inode: stat.ino, sha256: crypto.createHash("sha256").update(fs.readFileSync(canonicalPath)).digest("hex") };
}

function confinementEvidence(roots) {
  const checks = [
    ["authority-read", "authorityRoot", "file-read-data", "DENIED"], ["authority-write", "authorityRoot", "file-write-data", "DENIED"],
    ["controller-write", "controllerRoot", "file-write-data", "DENIED"], ["target-write", "targetRoot", "file-write-data", "DENIED"],
    ["workspace-write", "workspaceRoot", "file-write-data", "ALLOWED"], ["network-inbound", null, "network-inbound", "DENIED"], ["network-outbound", null, "network-outbound", "DENIED"],
  ];
  const source = [
    "import ctypes,json,os,sys", "lib=ctypes.CDLL('/usr/lib/libsandbox.dylib')", "check=lib.sandbox_check", "check.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int]", "check.restype=ctypes.c_int",
    "roots=json.loads(os.environ['OFFLINE_EXECUTOR_ROOTS'])", "checks=json.loads(os.environ['OFFLINE_EXECUTOR_CHECKS'])", "pid=int(sys.argv[1])",
    "def run(p):", " out=[]", " for operation,subject,native,expected in checks:", "  status=check(p,native.encode(),0) if subject is None else check(p,native.encode(),1,ctypes.c_char_p(roots[subject].encode()))", "  out.append({'operation':operation,'subject':subject,'nativeOperation':native,'expectedPermission':expected,'nativeStatus':status,'observedPermission':'DENIED' if status==1 else ('ALLOWED' if status==0 else 'QUERY_ERROR')})", " return out",
    "print(json.dumps({'executor':run(pid),'descendant':run(os.getpid()),'descendantPid':os.getpid()}))",
  ].join("\n");
  const result = spawnSync("/usr/bin/python3", ["-B", "-c", source, String(process.pid)], { encoding: "utf8", env: { ...process.env, OFFLINE_EXECUTOR_ROOTS: JSON.stringify(roots), OFFLINE_EXECUTOR_CHECKS: JSON.stringify(checks) } });
  let parsed; try { parsed = JSON.parse(result.stdout); } catch { throw new Error("EXECUTOR_CONFINEMENT_EVIDENCE_INVALID"); }
  if (result.status !== 0 || result.stderr !== "" || !Array.isArray(parsed.executor) || !Array.isArray(parsed.descendant)) throw new Error("EXECUTOR_CONFINEMENT_EVIDENCE_INCOMPLETE");
  for (const context of ["executor", "descendant"]) for (const record of parsed[context]) if (record.observedPermission !== record.expectedPermission) throw new Error(`EXECUTOR_CONFINEMENT_FAILED:${context}:${record.operation}`);
  return { mechanism: "MACOS_SANDBOX_CHECK", policyDigest: process.env.OFFLINE_POLICY_DIGEST, executorPid: process.pid, descendantPid: parsed.descendantPid, records: [...parsed.executor.map((item) => ({ ...item, context: "executor" })), ...parsed.descendant.map((item) => ({ ...item, context: "descendant" }))], protectedPathMutationAttempts: 0 };
}

let activeRequest = null;
function main() {
  const bytes = fs.readFileSync(0); const request = decodeExecutionFrame(bytes, { allowedTypes: EXECUTOR_EVENT_TYPES, expectedSequence: 0 }); activeRequest = request;
  if (request.type !== "tool_request") throw new Error("EXECUTOR_TOOL_REQUEST_REQUIRED");
  const payload = request.payload; const keys = Object.keys(payload).sort().join("\0");
  if (keys !== ["content", "expectedOperation", "operation", "path"].sort().join("\0") || payload.operation !== "write_fixture" || payload.path !== PILOT_PATH || !["ADD", "MODIFY"].includes(payload.expectedOperation) || typeof payload.content !== "string") throw new Error("EXECUTOR_TOOL_REQUEST_INVALID");
  const workspaceRoot = fs.realpathSync(process.env.OFFLINE_WORKSPACE_ROOT); const roots = { authorityRoot: process.env.OFFLINE_AUTHORITY_ROOT, controllerRoot: process.env.OFFLINE_CONTROLLER_ROOT, targetRoot: process.env.OFFLINE_TARGET_ROOT, workspaceRoot };
  const before = { workspaceRoot: identity(workspaceRoot) };
  const confinement = confinementEvidence(roots);
  const file = path.join(workspaceRoot, PILOT_PATH); const existed = fs.existsSync(file);
  if ((payload.expectedOperation === "ADD") === existed) throw new Error("EXECUTOR_OPERATION_MISMATCH");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, payload.content, { encoding: "utf8", mode: 0o644 }); fs.chmodSync(file, 0o644);
  const after = { workspaceRoot: identity(workspaceRoot) };
  for (const name of Object.keys(before)) if (JSON.stringify(before[name]) !== JSON.stringify(after[name])) throw new Error(`EXECUTOR_ROOT_IDENTITY_DRIFT:${name}`);
  const stat = fs.lstatSync(file); const result = createExecutionFrame({ executionId: request.executionId, taskDigest: request.taskDigest, sequence: 1, type: "tool_result", allowedTypes: EXECUTOR_EVENT_TYPES, payload: { operation: payload.operation, path: PILOT_PATH, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), mode: (stat.mode & 0o777).toString(8).padStart(4, "0"), workspaceIdentity: before.workspaceRoot, executableIdentity: executableIdentity(), confinement } });
  process.stdout.write(encodeExecutionFrame(result, { allowedTypes: EXECUTOR_EVENT_TYPES }));
}

try { main(); } catch (error) {
  try {
    if (activeRequest) process.stdout.write(encodeExecutionFrame(createExecutionFrame({ executionId: activeRequest.executionId, taskDigest: activeRequest.taskDigest, sequence: 1, type: "executor_failure", allowedTypes: EXECUTOR_EVENT_TYPES, payload: { code: error.code ?? error.message, message: error.message } }), { allowedTypes: EXECUTOR_EVENT_TYPES }));
  } catch { process.stderr.write(`${error.message}\n`); }
  process.exitCode = 2;
}
