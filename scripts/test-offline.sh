#!/bin/sh
set -eu

policy='(version 1) (allow default) (deny network*)'

boundary_root="$(mktemp -d /private/tmp/gov002-activation-boundary.XXXXXX)"
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
boundary_policy="(version 1) (allow default) (deny network*) (deny file-read* file-write* (subpath \"$authority_root\")) (deny file-write* (subpath \"$controller_root\")) (deny file-write* (subpath \"$target_root\")) (allow file-write* (subpath \"$role_output_root\"))"

AUTHORITY_ROOT="$authority_root" \
CONTROLLER_ROOT="$controller_root" \
TARGET_ROOT="$target_root" \
ROLE_OUTPUT_ROOT="$role_output_root" \
/usr/bin/sandbox-exec -p "$boundary_policy" /usr/local/bin/node test/helpers/activation-confinement-probe.mjs

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

export GOV002_FS_BOUNDARY_PROVED=MACOS_SANDBOX_EXEC_DIRECT_AND_DESCENDANT_DENIAL
exec /usr/bin/sandbox-exec -p "$policy" /usr/local/bin/node --test --test-concurrency=1 test/*.test.mjs
