# GOV-002 Real-Pilot Activation Gate Revision 2 — Builder Handoff

## Scope and baseline

- Accepted parent: `216e43a4d1305221eb42eb10fee40e8dc5c8cc99`.
- Controller branch: `main`, tracking the sole approved `origin/main`.
- Protected target: no content, mode, ref, configuration, staged state, or worktree mutation. A prior read inspection refreshed raw index stat-cache bytes; the Architect classified raw index SHA-256 as diagnostic rather than normative and prohibited repair/reset.
- Authority-state schema version: `3`; immutable grant schema version: `2`; existing fixture schema versions remain supported. Raw-index-only grant evidence is rejected as incompatible.
- New authority capability: inactive without a validated protected-store grant and exact admission evidence.

Revision 2 closes the two independent-review findings without reopening accepted behavior: authority provenance is now derived from controller-owned canonical policy at each consumption boundary, and integration eligibility is checked before intent and rechecked under the authoritative state lock. It keeps providers, publication, scheduling, paid fallback, email, automatic role launch, target push, and real authority provisioning unavailable.

## Human authorization and ledger

`authorize-pilot` validates the reviewed published controller, exact request and target, authority-store binding, and native boundary evidence before displaying the entire grant and digest. It has no automatic approval path and accepts only digest-specific interactive confirmation. Immutable grant content is canonically hashed; mutable consumption state is separate. The one ledger retains previous authorization records and rejects copies, alteration, changed requests, and reuse.

`show-authorization`, admission, integration, replay, and reconciliation independently bind the actual state path to controller-owned policy before trusting ledger assertions. The only production root is `/Users/yuriy/Library/Application Support/AI Agent Radar Orchestrator/authority/`; disposable authority is explicitly test-scoped below the OS temporary root and cannot authorize the protected real target. Admission persists the claim, one cycle, one task, and one receipt atomically.

`integrate-local` accepts no target, branch, candidate, commit, or time override. It rejects holds, reconciliation, wrong cycle/stage, and stale candidate/review/Architect/validation evidence before intent, then repeats those checks with authority and target identity under the state lock immediately before `INTEGRATING`. Integration persists intent before target mutation, uses expected-old ref protection, preserves candidate identity, records one outcome, and consumes permission only after verified completion. Uncertain post-intent outcomes enter reconciliation and cannot retry automatically.

## Boundary and evidence

The offline wrapper first runs a standalone native `sandbox-exec` probe combining `(deny network*)` with authority read/write and controller/target write denial. It proves direct and descendant denial and a designated output write. It then runs the complete suite under the unchanged native network-denial policy and independently checks `network-inbound` and `network-outbound` denial.

Protected-target pre/post evidence uses the Node-only manifest method: NUL-delimited paths from `git -c core.optionalLocks=false ls-files -co --exclude-standard -z`, lexical deduplication/sort, regular-file enforcement, Node `crypto` SHA-256, and exact `JSON.stringify(records, null, 2) + "\n"` bytes. Modes, refs, configuration, semantic index, status, repository identity, and pilot-path absence are separately compared.

The normative index evidence is `git-index-semantic-v1`, not raw `.git/index` bytes. Sanitized, no-optional-lock Git inspection preserves NUL-delimited paths as Buffers, sorts them with `Buffer.compare`, encodes raw paths as Base64, and hashes exactly `JSON.stringify({ format: "git-index-semantic-v1", entries }) + "\n"`. Each entry contains `pathBase64`, `mode`, `oid`, and `stage: 0`. The normalized index must equal the normalized `HEAD` tree; every index flag must be ordinary uppercase `H`; status and cached diff must be empty. Raw index digests remain separate diagnostics.

Historical diagnostic record: preflight raw index SHA-256 was `7096247d57c1d4cb64b0c5a93edd453a28b062513c5d2ccc2b4710336e71e2ec`; after the inspection refresh it was `e437e3edd0d4902de147d2fa3297d7260927903f9368819f848870ddcd1f1d64`. No pre-edit semantic snapshot is claimed. Subsequent semantic inspection confirmed the unchanged approved `HEAD` with digest `835376b52b9cf22fc0ca52ffa59db3530e28c302bc6b2feced5320e3e9e1b959`.

## Compatibility and deviations

Authorized compatibility update: test/schemas.test.mjs extended for the three approved activation-gate schemas; all prior exact schema inventory and validation coverage preserved.

No other existing test was changed merely for compatibility. No dependency, workflow, signing infrastructure, production provisioning, provider adapter, publication script, or live-operation adapter was added.

## Verification record

- Final complete offline suite: 138 tests passed, 0 failed, through `/bin/sh scripts/test-offline.sh` under native network denial after a successful combined filesystem/network confinement probe. This is the exact top-level count emitted by the Node test runner; it emitted no separate nested aggregate count.
- Public CLI: interactive digest confirmation through final local integration exercised solely against disposable repositories and authority storage.
- Authority provenance: fabricated payload, copied/rebound internally consistent ledger, direct public `integrate-local`, and disposable-store/real-target attempts are rejected before real-cycle creation or integration intent.
- Locked eligibility: initial human hold, a hold introduced between checks, unresolved checkpoint reconciliation, and stale cycle/candidate/Analyst/Architect/validation state are rejected without target mutation.
- Semantic preservation: stat-cache-only raw index changes pass when semantics remain stable; staged add/modify/delete/mode/path/blob changes, unmerged stages, intent-to-add, assume-unchanged, and skip-worktree fail. Spaces, tabs, and newlines in fixture paths are covered with NUL-safe serialization.
- Uncertainty: before-intent safe failure and after-intent/ref/worktree/before-receipt reconciliation cases exercised with no retry.
- Summary behavior: each Analyst review retains one iteration summary; terminal activation outcomes retain one `HUMAN_ASSISTED` final summary; notification delivery remains simulated.
- Candidate/target: exact candidate commit is preserved; production and remote-tracking refs and all pre-existing files/modes remain unchanged.

## Stop condition

This Builder checkpoint is local only. No real authority directory was created, no real authorization was issued, no real pilot ran, no protected-target mutation occurred, and no push was performed. Stop for independent Analyst review, followed by Architect disposition.
