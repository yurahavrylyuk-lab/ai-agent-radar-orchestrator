#!/bin/sh
set -eu

policy='(version 1) (allow default) (deny network*)'
wrapper_pass=0
wrapper_fail=0

emit_wrapper_summary() {
  printf 'OFFLINE_WRAPPER_CHECKS pass=%s fail=%s\n' "$wrapper_pass" "$wrapper_fail"
}

wrapper_check() {
  if "$@"; then
    wrapper_pass=$((wrapper_pass + 1))
  else
    wrapper_fail=$((wrapper_fail + 1))
    emit_wrapper_summary
    exit 1
  fi
}

wrapper_expect_failure() {
  if "$@"; then
    wrapper_fail=$((wrapper_fail + 1))
    emit_wrapper_summary
    exit 1
  else
    wrapper_pass=$((wrapper_pass + 1))
  fi
}

tap_value() {
  awk -v field="$2" '$1 == "#" && $2 == field && $3 ~ /^[0-9]+$/ { count += 1; value = $3 } END { if (count == 1) print value; else exit 1 }' "$1"
}

parse_tap_aggregate() {
  TAP_TESTS="$(tap_value "$1" tests)" || return 1
  TAP_PASS="$(tap_value "$1" pass)" || return 1
  TAP_FAIL="$(tap_value "$1" fail)" || return 1
  TAP_CANCELLED="$(tap_value "$1" cancelled)" || return 1
  TAP_SKIPPED="$(tap_value "$1" skipped)" || return 1
  TAP_TODO="$(tap_value "$1" todo)" || return 1
  test "$TAP_TESTS" -eq $((TAP_PASS + TAP_FAIL + TAP_CANCELLED + TAP_SKIPPED + TAP_TODO))
}

report_runner() {
  if ! parse_tap_aggregate "$1"; then
    printf 'OFFLINE_RUNNER_AGGREGATE unavailable: missing or malformed TAP summary\n' >&2
    return 65
  fi
  printf 'OFFLINE_RUNNER_AGGREGATE tests=%s pass=%s fail=%s\n' "$TAP_TESTS" "$TAP_PASS" "$TAP_FAIL"
  test "$2" -eq 0
}

reporting_fixture="$(mktemp -d /private/tmp/gov002-reporting-self-test.XXXXXX)"
cleanup_reporting_fixture() { rm -rf "$reporting_fixture"; }
trap cleanup_reporting_fixture EXIT HUP INT TERM
printf '%s\n' '# tests 2' '# pass 1' '# fail 1' '# cancelled 0' '# skipped 0' '# todo 0' > "$reporting_fixture/valid.tap"
: > "$reporting_fixture/missing.tap"
printf '%s\n' '# tests two' '# pass 2' '# fail 0' '# cancelled 0' '# skipped 0' '# todo 0' > "$reporting_fixture/malformed.tap"
wrapper_expect_failure parse_tap_aggregate "$reporting_fixture/missing.tap"
wrapper_expect_failure parse_tap_aggregate "$reporting_fixture/malformed.tap"
if report_runner "$reporting_fixture/valid.tap" 1 > /dev/null 2>&1; then
  wrapper_fail=$((wrapper_fail + 1)); emit_wrapper_summary; exit 1
else
  wrapper_pass=$((wrapper_pass + 1))
fi
wrapper_failure_output="$reporting_fixture/wrapper-failure.txt"
if (wrapper_pass=0; wrapper_fail=0; wrapper_check false) > "$wrapper_failure_output" 2>&1; then
  wrapper_fail=$((wrapper_fail + 1)); emit_wrapper_summary; exit 1
fi
wrapper_check grep -qx 'OFFLINE_WRAPPER_CHECKS pass=0 fail=1' "$wrapper_failure_output"
cleanup_reporting_fixture
trap - EXIT HUP INT TERM

boundary_root="$(mktemp -d /private/tmp/gov002-activation-boundary.XXXXXX)"
canonical_boundary_root="$(/usr/local/bin/node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$boundary_root")"
wrapper_check test "$boundary_root" = "$canonical_boundary_root"
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
wrapper_check test "$(/usr/local/bin/node -e 'const s=require("node:fs").statSync(process.argv[1]);process.stdout.write(`${s.dev}:${s.ino}`)' "$boundary_root")" = "$boundary_identity"
boundary_policy="(version 1) (allow default) (deny network*) (deny file-read* file-write* (subpath \"$authority_root\")) (deny file-write* (subpath \"$controller_root\")) (deny file-write* (subpath \"$target_root\")) (allow file-write* (subpath \"$role_output_root\"))"

wrapper_check /usr/local/bin/node --input-type=module -e '
import fs from "node:fs";
import { assertConfinementProbeResults, runConfinementDiagnostic } from "./src/operator-boundary.mjs";
const [authorityRoot, controllerRoot, targetRoot, roleOutputRoot, evidencePath] = process.argv.slice(1);
const evidence = runConfinementDiagnostic({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot });
assertConfinementProbeResults(evidence);
fs.writeFileSync(evidencePath, JSON.stringify(evidence));
' "$authority_root" "$controller_root" "$target_root" "$role_output_root" "$role_output_root/confinement-evidence.json"

wrapper_check /usr/local/bin/node --input-type=module -e '
import fs from "node:fs";
import { runNativePermissionDiagnostic } from "./src/operator-boundary.mjs";
const [authorityRoot, controllerRoot, targetRoot, roleOutputRoot, evidencePath] = process.argv.slice(1);
const evidence = runNativePermissionDiagnostic({ authorityRoot, controllerRoot, targetRoot, roleOutputRoot });
fs.writeFileSync(evidencePath, JSON.stringify(evidence));
' "$authority_root" "$controller_root" "$target_root" "$role_output_root" "$role_output_root/native-confinement-evidence.json"

if AUTHORITY_ROOT="$authority_root" \
CONTROLLER_ROOT="$controller_root" \
TARGET_ROOT="$target_root" \
ROLE_OUTPUT_ROOT="$role_output_root" \
/usr/bin/sandbox-exec -p "$boundary_policy" /usr/local/bin/node test/helpers/activation-confinement-probe.mjs; then
  wrapper_pass=$((wrapper_pass + 1))
else
  wrapper_fail=$((wrapper_fail + 1)); emit_wrapper_summary; exit 1
fi

wrapper_check test "$(/usr/local/bin/node -e 'const s=require("node:fs").statSync(process.argv[1]);process.stdout.write(`${s.dev}:${s.ino}`)' "$boundary_root")" = "$boundary_identity"
GOV002_FS_BOUNDARY_EVIDENCE="$(cat "$role_output_root/confinement-evidence.json")"
export GOV002_FS_BOUNDARY_EVIDENCE
GOV002_NATIVE_BOUNDARY_EVIDENCE="$(cat "$role_output_root/native-confinement-evidence.json")"
export GOV002_NATIVE_BOUNDARY_EVIDENCE

cleanup_boundary
trap - EXIT HUP INT TERM

wrapper_check /usr/bin/sandbox-exec -p "$policy" /usr/bin/python3 -B -c '
import ctypes, os
lib = ctypes.CDLL("/usr/lib/libsandbox.dylib")
check = lib.sandbox_check
check.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
check.restype = ctypes.c_int
results = {name: check(os.getpid(), name.encode(), 0) for name in ("network-outbound", "network-inbound")}
print(results)
assert all(value == 1 for value in results.values())
'

export GOV002_FS_BOUNDARY_PROVED=MACOS_SANDBOX_EXEC_DIRECT_AND_DESCENDANT_DENIAL
runner_output="$(mktemp /private/tmp/gov002-node-test-output.XXXXXX)"
runner_fifo="$runner_output.fifo"
mkfifo "$runner_fifo"
cleanup_runner() { rm -f "$runner_output" "$runner_fifo"; }
trap cleanup_runner EXIT HUP INT TERM
tee "$runner_output" < "$runner_fifo" &
tee_pid=$!
set +e
/usr/bin/sandbox-exec -p "$policy" /usr/local/bin/node --test --test-reporter=tap --test-concurrency=1 test/*.test.mjs > "$runner_fifo" 2>&1
runner_status=$?
wait "$tee_pid"
tee_status=$?
set -e
wrapper_check test "$tee_status" -eq 0
set +e
report_runner "$runner_output" "$runner_status"
report_status=$?
set -e
emit_wrapper_summary
exit "$report_status"
