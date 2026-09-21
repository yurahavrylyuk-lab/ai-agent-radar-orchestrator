# GOV-002 Phase 2 Builder Handoff

## Status

Implementation iteration 1 is ready for independent Analyst review. It is not approved for real-pilot activation and is not GOV-002 completion.

The implementation adds strict task/result contracts, deterministic role handoffs, locked versioned persistence, explicit v1-to-v2 migration, waiting/execution accounting, independent local Git workspaces, trusted local checkpoint verification, fixture-only identity-preserving integration, a command-line operator surface, and a deterministic two-iteration rehearsal.

Authorized compatibility update: test/schemas.test.mjs adjusted for the four approved Phase 2 schemas; all original Phase 1 schema coverage preserved.

## Verification Evidence

- Original Phase 1 behavior: all 46 cases remain present and pass.
- Expanded suite: 75 tests pass with concurrency forced to one at the Node test-runner level; tests themselves include real competing child processes.
- Mandatory invocation: `/bin/sh scripts/test-offline.sh`.
- Enforced policy: `(version 1) (allow default) (deny network*)`.
- Native policy evidence: both `network-outbound` and `network-inbound` return denied (`1`).
- Real local Git fixtures verify independent workspaces, no remotes or alternates, linear candidates, exact cumulative ADD scope, symlink/mode/dirty/out-of-scope rejection, expected-old integration, candidate identity preservation, and unchanged fixture `main`.
- Rehearsal: Architect plan → candidate 1 → Analyst REVISE → immutable summary 1 → Architect revision → candidate 2 → Analyst PASS → immutable summary 2 → Architect ACCEPT → fixture integration → final summary.
- Final rehearsal identifiers: cycle `cycle:rehearsal-request`; candidates `99970517b387490e29ad029770db7c5b05077f91` and `ebcfe90ebd350bc263851a07b00bca0aa21f2bcb`; summaries `summary:cycle:rehearsal-request:iteration:1`, `summary:cycle:rehearsal-request:iteration:2`, and `summary:cycle:rehearsal-request:final` (digest `2d9440a309c955e6c4284ff82cfa82ac4b49a9887f7c8d3b2f019816cd20be79`).
- Restart-safe evidence is persisted at every handoff. Exact replay returns the original receipt without state change; conflicting replay fails. Two real processes produce one accepted result transaction. Migration preserves exact source bytes and digest. Checkpoint and integration uncertainty create durable reconciliation holds and prohibit automatic retries.

## Target-Preservation Method

The Builder baseline is stored in the ignored `.runtime/phase2-r1-builder-evidence` directory outside the target. The Node-only snapshot procedure obtains paths with `git ls-files -co --exclude-standard -z`, deduplicates and lexically sorts them, rejects unsupported filesystem entries, hashes regular-file bytes with built-in `node:crypto` SHA-256, serializes exactly as `JSON.stringify(records, null, 2) + "\n"`, and compares the exact bytes and digest after implementation. Modes, symbolic HEAD, refs, status, target Git config, and target index are checked separately.

The pre/post manifests are byte-identical: 75 files and SHA-256 `8b64f934c5bef4a8dc43e406f9cfbbba243e43497e3b91990f762c2366b52629`. Mode manifests are byte-identical at SHA-256 `b43ac246e369f55f789377a2f3b910ac013072921dff986fb3b2715d6252de46`. Symbolic HEAD, all five protected refs, empty status, Git config digest, and index digest also match. The real pilot path remains absent.

## Prohibited Capabilities and Limits

- No dependency or downloaded tool was added.
- No live model/provider, paid fallback, email, scheduler, deployment, remote publication, or target-writing adapter is enabled.
- Controller Git has no remote and the checkpoint remains local-only.
- Real-target initialization and integration fail with `REAL_PILOT_NOT_AUTHORIZED`.
- Fixture success is explicitly `SIMULATED`; it cannot satisfy a later real-pilot gate.
- Workspaces have no remotes, credentials, inherited hooks, alternates, or shared Git metadata. Human-operated sessions still require later host-permission verification.
- Filesystem durability is limited to successful file and parent-directory `fsync`. Post-rename uncertainty is reported, never silently treated as failure or success.

The exact implementation commit is returned separately after final verification so this document does not require self-amendment. The independent Analyst must review that commit without modifying it.
