# Simple Offline Autopilot V1 Builder handoff

## Scope

The human-started `autopilot-offline` command runs the existing controller's
Architect, Builder, validation, Analyst, and final Architect handoffs using
deterministic offline fixtures. It stops at `READY_FOR_INTEGRATION`. It never
integrates, contacts a provider, publishes, deploys, consumes production
authority, resumes the historical pilot, or modifies the protected target.

## Fresh-run model

Every run requires a new direct child of an approved system temporary root.
The leaf is created non-recursively with mode `0700`; existing files,
directories, and symlinks are rejected. Internal paths exist only in memory and
are derived from the guarded root. There is no resume, repair, reconciliation,
or durable timing reconstruction. On a handled error the runner records
`FAILED` when possible, preserves the runtime for inspection, exits nonzero,
and permanently refuses that runtime path.

The simple progress projection is `CREATED`, `ARCHITECT`, `BUILDER`,
`VALIDATING`, `ANALYST`, `ARCHITECT_FINAL`, then
`READY_FOR_INTEGRATION`; errors project `FAILED`. The ordinary controller state
and its validated role results remain authoritative.

## Builder and validation boundary

The Builder is a real child process under the reviewed macOS `sandbox-exec`
profile. Before writing, it verifies direct and descendant denial for authority
read/write, controller write, protected-target write, inbound network, and
outbound network, plus allowed access to its disposable workspace. There is no
fallback. A controller-owned deadline terminates the child before it can write
when the deadline expires. `CONFINEMENT_VERIFIED` is recorded only after the
child returns complete passing process evidence.

The controller creates a real Git checkpoint. All three validation recipes
read the authorized file's mode and bytes from the exact candidate tree/blob,
not from the mutable workspace. Evidence binds the baseline, candidate, tree,
blob object ID, SHA-256, mode, reviewed template version, recipe version,
execution ID, and outcome. The accepted content is the single reviewed
deterministic offline-fixture template; unknown or prohibited content fails.

## Scenarios and evidence

`success` reaches Architect `ACCEPT` in iteration one. `revision` commits a
defective fixture in iteration one, derives Analyst `REVISE` from actual failed
validation evidence, follows the controller-generated revision, commits the
reviewed template in iteration two, and reaches `ACCEPT`. Both stop before any
integration intent or target-ref update.

The final Builder verification ran the complete OS-network-denied wrapper:
183 TAP tests passed, zero failed, and 13 wrapper checks passed, zero failed.
The wrapper separately exercised real Builder and descendant confinement in
disposable repositories. Independent Analyst review must use the exact local
checkpoint reported with this handoff.

## Limitations

V1 has no live model transport, crash resume, mid-role recovery, automatic
integration, provider access, publication, deployment, scheduling, email, or
spending configuration. An uncatchable process crash may leave incomplete
state; that runtime remains dead by design.
