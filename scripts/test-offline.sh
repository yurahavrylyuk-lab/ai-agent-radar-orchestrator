#!/bin/sh
set -eu

policy='(version 1) (allow default) (deny network*)'
wrapper_checks=0

boundary_root="$(mktemp -d /private/tmp/gov002-activation-boundary.XXXXXX)"
canonical_boundary_root="$(/usr/local/bin/node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$boundary_root")"
test "$boundary_root" = "$canonical_boundary_root"
wrapper_checks=$((wrapper_checks + 1))
boundary_identity="$(/usr/local/bin/node -e 'const s=require("node:fs").statSync(process.argv[1]);process.stdout.write(`${s.dev}:${s.ino}`)' "$boundary_root")"
cleanup_boundary() {
  /usr/local/bin/node -e 'require("node:fs").rmSync(process.argv[1], { recursive: true, force: true })' "$boundary_root"
}
trap cleanup_boundary EXIT HUP INT TERM
authority_root="$boundary_root/authority"
controller_root="$boundary_root/controller"
target_root="$boundary_root/target"
role_output_root="$boundary_root/role-output"
mkdir -m 700 "$authority_root" "$controller_root" "$target_root" "$role_output_root"
printf '%s\n' authority-sentinel > "$authority_root/sentinel"
test "$(/usr/local/bin/node -e 'const s=require("node:fs").statSync(process.argv[1]);process.stdout.write(`${s.dev}:${s.ino}`)' "$boundary_root")" = "$boundary_identity"
wrapper_checks=$((wrapper_checks + 1))
boundary_policy="(version 1) (allow default) (deny network*) (deny file-read* file-write* (subpath \"$authority_root\")) (deny file-write* (subpath \"$controller_root\")) (deny file-write* (subpath \"$target_root\")) (allow file-write* (subpath \"$role_output_root\"))"

/usr/local/bin/node --input-type=module -e '
import fs from "node:fs";
import { assertConfinementProbeResults, runConfinementDiagnostic } from "./src/operator-boundary.mjs";
const [authorityRoot, controllerRoot, targetRoot, roleOutputRoot, evidencePath] = process.argv.slice(1);
const evidence = runConfinementDiagnostic({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot });
assertConfinementProbeResults(evidence);
fs.writeFileSync(evidencePath, JSON.stringify(evidence));
' "$authority_root" "$controller_root" "$target_root" "$role_output_root" "$role_output_root/confinement-evidence.json"
wrapper_checks=$((wrapper_checks + 1))

/usr/local/bin/node --input-type=module -e '
import fs from "node:fs";
import { runNativePermissionDiagnostic } from "./src/operator-boundary.mjs";
const [authorityRoot, controllerRoot, targetRoot, roleOutputRoot, evidencePath] = process.argv.slice(1);
const evidence = runNativePermissionDiagnostic({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot });
fs.writeFileSync(evidencePath, JSON.stringify(evidence));
' "$authority_root" "$controller_root" "$target_root" "$role_output_root" "$role_output_root/native-confinement-evidence.json"
wrapper_checks=$((wrapper_checks + 1))

AUTHORITY_ROOT="$authority_root" \
CONTROLLER_ROOT="$controller_root" \
TARGET_ROOT="$target_root" \
ROLE_OUTPUT_ROOT="$role_output_root" \
/usr/bin/sandbox-exec -p "$boundary_policy" /usr/local/bin/node test/helpers/activation-confinement-probe.mjs
wrapper_checks=$((wrapper_checks + 1))

test "$(/usr/local/bin/node -e 'const s=require("node:fs").statSync(process.argv[1]);process.stdout.write(`${s.dev}:${s.ino}`)' "$boundary_root")" = "$boundary_identity"
wrapper_checks=$((wrapper_checks + 1))
GOV002_FS_BOUNDARY_EVIDENCE="$(cat "$role_output_root/confinement-evidence.json")"
export GOV002_FS_BOUNDARY_EVIDENCE
GOV002_NATIVE_BOUNDARY_EVIDENCE="$(cat "$role_output_root/native-confinement-evidence.json")"
export GOV002_NATIVE_BOUNDARY_EVIDENCE

cleanup_boundary
trap - EXIT HUP INT TERM

/usr/bin/sandbox-exec -p "$policy" /usr/bin/python3 -B -c '
import ctypes, os
lib = ctypes.CDLL("/usr/lib/libsandbox.dylib")
check = lib.sandbox_check
check.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
check.restype = ctypes.c_int
results = {name: check(os.getpid(), name.encode(), 0) for name in ("network-outbound", "network-inbound")}
print(results)
assert all(value == 1 for value in results.values())
'
wrapper_checks=$((wrapper_checks + 1))

export GOV002_FS_BOUNDARY_PROVED=MACOS_SANDBOX_EXEC_DIRECT_AND_DESCENDANT_DENIAL
runner_output="$(mktemp /private/tmp/gov002-node-test-output.XXXXXX)"
cleanup_runner() { rm -f "$runner_output"; }
trap cleanup_runner EXIT HUP INT TERM
set +e
/usr/bin/sandbox-exec -p "$policy" /usr/local/bin/node --test --test-reporter=tap --test-concurrency=1 test/*.test.mjs > "$runner_output" 2>&1
runner_status=$?
set -e
cat "$runner_output"
tests_total="$(awk '/^# tests [0-9]+$/ { value=$3 } END { print value }' "$runner_output")"
tests_pass="$(awk '/^# pass [0-9]+$/ { value=$3 } END { print value }' "$runner_output")"
tests_fail="$(awk '/^# fail [0-9]+$/ { value=$3 } END { print value }' "$runner_output")"
test -n "$tests_total" && test -n "$tests_pass" && test -n "$tests_fail"
printf 'OFFLINE_RUNNER_AGGREGATE tests=%s pass=%s fail=%s\n' "$tests_total" "$tests_pass" "$tests_fail"
printf 'OFFLINE_WRAPPER_CHECKS pass=%s fail=0\n' "$wrapper_checks"
test "$runner_status" -eq 0
