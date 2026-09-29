#!/usr/local/bin/node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function validPath(value) {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.split("/").some((part) => !part || part === "." || part === "..") && value !== ".git" && !value.startsWith(".git/") && !value.split("/").some((part) => part === ".env" || part.startsWith(".env.")) && !/^(?:wrangler(?:\..+)?|cloudflare(?:\..+)?|docker-compose(?:\..+)?|compose(?:\..+)?)$/iu.test(path.basename(value)) && !value.startsWith(".github/workflows/");
}
function validContent(value) {
  return typeof value === "string" && !/(?:-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:api[_ -]?key|secret|credential|password|token)\s*[:=]|(?:sk-(?:proj-|[A-Za-z0-9_-]))[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16})/iu.test(value);
}
function assertDirectoryPath(root, directory) {
  const relative = path.relative(root, directory);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current, { mode: 0o700 });
      continue;
    }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("GENERAL_BUILDER_SYMLINK_OR_NON_DIRECTORY");
  }
}
function confinementEvidence() {
  const roots = JSON.parse(process.env.GENERAL_BOUNDARY_ROOTS ?? "null");
  const policyDigest = process.env.GENERAL_POLICY_DIGEST;
  if (!roots || typeof roots !== "object" || typeof policyDigest !== "string") throw new Error("GENERAL_EXECUTOR_CONFINEMENT_CONTEXT_REQUIRED");
  const checks = [["authority-read", "authorityRoot", "file-read-data", "DENIED"], ["authority-write", "authorityRoot", "file-write-data", "DENIED"], ["controller-write", "controllerRoot", "file-write-data", "DENIED"], ["target-write", "targetRoot", "file-write-data", "DENIED"], ["workspace-write", "workspaceRoot", "file-write-data", "ALLOWED"], ["network-inbound", null, "network-inbound", "DENIED"], ["network-outbound", null, "network-outbound", "DENIED"]];
  const source = ["import ctypes,json,os,subprocess,sys", "lib=ctypes.CDLL('/usr/lib/libsandbox.dylib')", "check=lib.sandbox_check", "check.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int]", "check.restype=ctypes.c_int", "roots=json.loads(os.environ['GENERAL_BOUNDARY_ROOTS'])", "checks=json.loads(os.environ['GENERAL_BOUNDARY_CHECKS'])", "def report():", " out=[]", " for operation,subject,native,expected in checks:", "  status=check(os.getpid(),native.encode(),0) if subject is None else check(os.getpid(),native.encode(),1,ctypes.c_char_p(roots[subject].encode()))", "  out.append({'operation':operation,'expectedPermission':expected,'observedPermission':'DENIED' if status==1 else ('ALLOWED' if status==0 else 'QUERY_ERROR')})", " return out", "if '--descendant' in sys.argv: print(json.dumps(report())); raise SystemExit(0)", "child=subprocess.run([sys.executable,'-B','-c',os.environ['GENERAL_CONFINEMENT_SOURCE'],'--descendant'],capture_output=True,text=True,env=os.environ)", "try: descendant=json.loads(child.stdout)", "except Exception: descendant=None", "print(json.dumps({'builder':report(),'descendant':descendant,'descendantExitStatus':child.returncode,'descendantStderr':child.stderr}))"].join("\n");
  const result = spawnSync("/usr/bin/python3", ["-B", "-c", source], { encoding: "utf8", env: { ...process.env, GENERAL_BOUNDARY_CHECKS: JSON.stringify(checks), GENERAL_CONFINEMENT_SOURCE: source } });
  let parsed; try { parsed = JSON.parse(result.stdout); } catch { throw new Error("GENERAL_EXECUTOR_CONFINEMENT_EVIDENCE_INVALID"); }
  if (result.status !== 0 || result.stderr !== "" || parsed.descendantExitStatus !== 0 || parsed.descendantStderr !== "" || !Array.isArray(parsed.builder) || !Array.isArray(parsed.descendant)) throw new Error("GENERAL_EXECUTOR_CONFINEMENT_EVIDENCE_INCOMPLETE");
  for (const context of ["builder", "descendant"]) for (const record of parsed[context]) if (record.observedPermission !== record.expectedPermission) throw new Error(`GENERAL_EXECUTOR_CONFINEMENT_FAILED:${context}:${record.operation}`);
  return { mechanism: "MACOS_SANDBOX_CHECK", policyDigest, records: [...parsed.builder.map((record) => ({ ...record, context: "builder" })), ...parsed.descendant.map((record) => ({ ...record, context: "descendant" }))] };
}
const input = JSON.parse(fs.readFileSync(0, "utf8"));
if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > 32) throw new Error("GENERAL_BUILDER_FILES_INVALID");
const root = fs.realpathSync(process.env.GENERAL_WORKSPACE_ROOT);
const confinement = process.env.GENERAL_TEST_CONFINEMENT === "1" ? { mechanism: "TEST_ONLY", policyDigest: "test", records: [] } : confinementEvidence();
for (const item of input.files) {
  if (!item || Object.keys(item).sort().join(",") !== "content,path" || !validPath(item.path) || !validContent(item.content) || Buffer.byteLength(item.content) > 262144) throw new Error("GENERAL_BUILDER_FILE_INVALID");
  const destination = path.resolve(root, item.path);
  if (!destination.startsWith(root + path.sep)) throw new Error("GENERAL_BUILDER_PATH_ESCAPE");
  assertDirectoryPath(root, path.dirname(destination));
  if (fs.existsSync(destination)) {
    const existing = fs.lstatSync(destination);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("GENERAL_BUILDER_DESTINATION_UNSAFE");
  }
  fs.writeFileSync(destination, item.content, { encoding: "utf8", mode: 0o644 });
  fs.chmodSync(destination, 0o644);
}
process.stdout.write(JSON.stringify({ written: input.files.map((item) => item.path), confinement }));
