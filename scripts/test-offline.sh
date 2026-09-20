#!/bin/sh
set -eu

policy='(version 1) (allow default) (deny network*)'

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

exec /usr/bin/sandbox-exec -p "$policy" /usr/local/bin/node --test --test-concurrency=1 test/*.test.mjs
