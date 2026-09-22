# GOV-002 Real-Pilot Activation Gate Revision 1 — Builder Handoff

## Scope and baseline

- Accepted parent: `6c58faacd57c7483e7e396c793d90ad805406d61`.
- Controller branch: `main`, tracking the sole approved `origin/main`.
- Protected target: read-only throughout implementation and verification.
- Authority-state schema version: `3`; immutable grant schema version: `1`; existing fixture schema versions remain supported.
- New authority capability: inactive without a validated protected-store grant and exact admission evidence.

The implementation adds trusted authorization creation, exact controller/remote identity checks, canonical authority-store binding, atomic single-use admission, and separate identity-preserving local integration. It keeps providers, publication, scheduling, paid fallback, email, automatic role launch, target push, and real authority provisioning unavailable.

## Human authorization and ledger

`authorize-pilot` validates the reviewed published controller, exact request and target, authority-store binding, and native boundary evidence before displaying the entire grant and digest. It has no automatic approval path and accepts only digest-specific interactive confirmation. Immutable grant content is canonically hashed; mutable consumption state is separate. The one ledger retains previous authorization records and rejects copies, alteration, changed requests, and reuse.

`show-authorization` reads the protected record. `integrate-local` accepts no target, branch, candidate, commit, or time override and derives every identity from the ledger. Admission persists the claim, one cycle, one task, and one receipt atomically. Integration persists intent before mutation, uses expected-old ref protection, preserves candidate identity, records a single outcome, and consumes the permission only after verified completion. Uncertain post-intent outcomes enter reconciliation and cannot retry automatically.

## Boundary and evidence

The offline wrapper first runs a standalone native `sandbox-exec` probe combining `(deny network*)` with authority read/write and controller/target write denial. It proves direct and descendant denial and a designated output write. It then runs the complete suite under the unchanged native network-denial policy and independently checks `network-inbound` and `network-outbound` denial.

Protected-target pre/post evidence uses the Node-only manifest method: NUL-delimited paths from `git -c core.optionalLocks=false ls-files -co --exclude-standard -z`, lexical deduplication/sort, regular-file enforcement, Node `crypto` SHA-256, and exact `JSON.stringify(records, null, 2) + "\n"` bytes. Modes, refs, configuration, index, status, and pilot-path absence are separately compared.

## Compatibility and deviations

Authorized compatibility update: test/schemas.test.mjs extended for the three approved activation-gate schemas; all prior exact schema inventory and validation coverage preserved.

No other existing test was changed merely for compatibility. No dependency, workflow, signing infrastructure, production provisioning, provider adapter, publication script, or live-operation adapter was added.

## Verification record

- Complete offline suite: 115 tests passed, 0 failed, through `/bin/sh scripts/test-offline.sh` under native network denial after a successful combined filesystem/network confinement probe.
- Public CLI: interactive digest confirmation through final local integration exercised solely against disposable repositories and authority storage.
- Anti-replay: restart replay, copied state, altered grant, changed request, and concurrent admission/integration cases exercised.
- Uncertainty: before-intent safe failure and after-intent/ref/worktree/before-receipt reconciliation cases exercised with no retry.
- Summary behavior: each Analyst review retains one iteration summary; terminal activation outcomes retain one `HUMAN_ASSISTED` final summary; notification delivery remains simulated.
- Candidate/target: exact candidate commit is preserved; production and remote-tracking refs and all pre-existing files/modes remain unchanged.

## Stop condition

This Builder checkpoint is local only. No real authority directory was created, no real authorization was issued, no real pilot ran, no protected-target mutation occurred, and no push was performed. Stop for independent Analyst review, followed by Architect disposition.
