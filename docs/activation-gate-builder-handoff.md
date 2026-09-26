# GOV-002 Real-Pilot Activation Gate Revision 3 — Builder Handoff

## Scope and baseline

- Accepted parent: `9b86fcdb4168e81b69cbc139c9489e1a347d2411`.
- Controller branch: `main`, tracking the sole approved `origin/main`.
- Protected target: no content, mode, ref, configuration, staged state, or worktree mutation. A prior read inspection refreshed raw index stat-cache bytes; the Architect classified raw index SHA-256 as diagnostic rather than normative and prohibited repair/reset.
- Authority-state schema version: `3`; immutable grant schema version: `2`; existing fixture schema versions remain supported. Raw-index-only grant evidence is rejected as incompatible.
- New authority capability: inactive without a validated protected-store grant and exact admission evidence.

Revision 3 removes destructive checkout reconstruction from the real integration path without reopening the accepted authority, hold, semantic-index, replay, or reconciliation protections. It keeps providers, publication, scheduling, paid fallback, email, automatic role launch, target push, and real authority provisioning unavailable.

## Human authorization and ledger

`authorize-pilot` validates the reviewed published controller, exact request and target, authority-store binding, and native boundary evidence before displaying the entire grant and digest. It has no automatic approval path and accepts only digest-specific interactive confirmation. Immutable grant content is canonically hashed; mutable consumption state is separate. The one ledger retains previous authorization records and rejects copies, alteration, changed requests, and reuse.

`show-authorization`, admission, integration, replay, and reconciliation independently bind the actual state path to controller-owned policy before trusting ledger assertions. The only production root is `/Users/yuriy/Library/Application Support/AI Agent Radar Orchestrator/authority/`; disposable authority is explicitly test-scoped below the OS temporary root and cannot authorize the protected real target. Admission persists the claim, one cycle, one task, and one receipt atomically.

`integrate-local` accepts no target, branch, candidate, commit, or time override. It rejects holds, reconciliation, wrong cycle/stage, and stale candidate/review/Architect/validation evidence before intent. Its version-4 durable intent records the pre-integration checkout baseline. After importing candidate objects, it holds the target and state locks together and repeats the exact authority, workflow, evidence, controller, repository, ref, semantic-index, manifest, modes, config, status, and pilot-path checks immediately before the one expected-old ref update.

The real mutation is ref-only: `refs/heads/self-improvement` advances to the exact reviewed candidate. There is no `read-tree --reset -u`, reset, checkout, restore, clean, index replacement, or worktree reconstruction. Success records `REF_ADVANCED_CHECKOUT_PRESERVED`: symbolic `HEAD` and the branch resolve to the candidate while the semantic index and worktree remain byte/semantically equal to their pre-integration baseline. The resulting checkout is intentionally unsynchronized and reports the authorized new file as staged deleted relative to the advanced `HEAD`. A separate human-controlled action is required for any later synchronization.

## Boundary and evidence

The offline wrapper first runs a standalone native `sandbox-exec` probe combining `(deny network*)` with authority read/write and controller/target write denial. It proves direct and descendant denial and a designated output write. It then runs the complete suite under the unchanged native network-denial policy and independently checks `network-inbound` and `network-outbound` denial.

Protected-target pre/post evidence uses the Node-only manifest method: NUL-delimited paths from `git -c core.optionalLocks=false ls-files -co --exclude-standard -z`, lexical deduplication/sort, regular-file enforcement, Node `crypto` SHA-256, and exact `JSON.stringify(records, null, 2) + "\n"` bytes. Modes, refs, configuration, semantic index, status, repository identity, and pilot-path absence are separately compared.

The normative index evidence is `git-index-semantic-v1`, not raw `.git/index` bytes. Sanitized, no-optional-lock Git inspection preserves NUL-delimited paths as Buffers, sorts them with `Buffer.compare`, encodes raw paths as Base64, and hashes exactly `JSON.stringify({ format: "git-index-semantic-v1", entries }) + "\n"`. Each entry contains `pathBase64`, `mode`, `oid`, and `stage: 0`. The normalized index must equal the normalized `HEAD` tree; every index flag must be ordinary uppercase `H`; status and cached diff must be empty. Raw index digests remain separate diagnostics.

Historical diagnostic record: preflight raw index SHA-256 was `7096247d57c1d4cb64b0c5a93edd453a28b062513c5d2ccc2b4710336e71e2ec`; after the inspection refresh it was `e437e3edd0d4902de147d2fa3297d7260927903f9368819f848870ddcd1f1d64`. No pre-edit semantic snapshot is claimed. Subsequent semantic inspection confirmed the unchanged approved `HEAD` with digest `835376b52b9cf22fc0ca52ffa59db3530e28c302bc6b2feced5320e3e9e1b959`.

## Compatibility and deviations

Authorized compatibility update: test/schemas.test.mjs extended for the three approved activation-gate schemas; all prior exact schema inventory and validation coverage preserved.

No other existing test was changed merely for compatibility. No dependency, workflow, signing infrastructure, production provisioning, provider adapter, publication script, or live-operation adapter was added.

## Verification record

- Final complete offline suite: 142 tests passed, 0 failed, through `/bin/sh scripts/test-offline.sh` under native network denial after a successful combined filesystem/network confinement probe. This is the exact top-level count emitted by the Node test runner; it emitted no separate nested aggregate count.
- Public CLI: interactive digest confirmation through final local integration exercised solely against disposable repositories and authority storage.
- Authority provenance: fabricated payload, copied/rebound internally consistent ledger, direct public `integrate-local`, and disposable-store/real-target attempts are rejected before real-cycle creation or integration intent.
- Locked eligibility: initial human hold, a hold introduced between checks, unresolved checkpoint reconciliation, stale cycle/candidate/Analyst/Architect/validation state, and late worktree/index/mode/config drift are rejected before ref mutation without checkout rewrite.
- Semantic preservation: stat-cache-only raw index changes pass when semantics remain stable; staged add/modify/delete/mode/path/blob changes, unmerged stages, intent-to-add, assume-unchanged, and skip-worktree fail. Spaces, tabs, and newlines in fixture paths are covered with NUL-safe serialization.
- Ref-only result: only the protected branch ref advances; candidate identity is exact; semantic index, worktree manifest, and modes remain at the pre-integration baseline; the precise unsynchronized porcelain status is recorded and never described as clean.
- Uncertainty: before-intent safe failure and after-intent/ref/before-receipt reconciliation cases exercised with no rollback or retry.
- Summary behavior: each Analyst review retains one iteration summary; terminal activation outcomes retain one `HUMAN_ASSISTED` final summary; notification delivery remains simulated.
- Candidate/target: exact candidate commit is preserved; production and remote-tracking refs and all pre-existing files/modes remain unchanged.

## Stop condition

This Builder checkpoint is local only. No real authority directory was created, no real authorization was issued, no real pilot ran, no protected-target mutation occurred, and no push was performed. Stop for independent Analyst review, followed by Architect disposition.

## Confinement canonicalization correction

The stopped trusted-authorization preflight exposed `ROLE_FILESYSTEM_CONFINEMENT_UNAVAILABLE:71`. Disposable A/B evidence reproduced the exact failure when the sandbox profile used Node's `/var/...` temporary spelling and showed all file protections succeed when the identical directories were addressed through their verified `/private/var/...` canonical spelling. Both spellings had the same device and inode. The correction therefore canonicalizes trusted boundary roots with `fs.realpathSync`, captures filesystem identity and ownership/mode evidence, permits only the proven macOS `/var` alias, rejects other symlink redirection, traversal, replacement, identity mismatch, and output/protected overlap, and constructs the policy and probe environment from the same canonical roots.

The verifier now records independent safe results for direct and descendant authority reads/writes, controller and target writes, the positive role-output control, and inbound/outbound network denial. Missing results, unexpected errors, forbidden side effects, or identity drift fail closed. The offline wrapper independently verifies its canonical disposable root and its device/inode before and after the confinement probe.

The revision-1 report of 149 top-level tests was not retained by the wrapper in a form the independent Analyst could reproduce and is therefore superseded rather than reused as acceptance evidence. Revision 2 captures the complete TAP stream and emits runtime-derived `OFFLINE_RUNNER_AGGREGATE` and separately counted `OFFLINE_WRAPPER_CHECKS` lines. No aggregate is hardcoded or inferred from visual markers.

Revision 2 also implements the previously documentation-only real-path diagnostic as independently callable controller code. It fixes the production authority, controller, and target roots in policy; accepts only a verified temporary output root; performs native non-mutating `sandbox_check` permission queries for direct and descendant contexts; validates network denial and output allowance; captures structured pre/post identity evidence; and fails closed on incomplete, unexpected, allowed-forbidden, denied-output, or identity-drift evidence. It has no authorization, proposal, ledger, grant, cycle, pilot, or integration call path.

Revision-2 retained execution evidence: the Node TAP runner emitted `tests 154`, `pass 154`, and `fail 0`; the separately derived wrapper layer emitted `OFFLINE_WRAPPER_CHECKS pass=7 fail=0`. These are distinct counting units. The standalone diagnostic then returned native status `1` (denied) for direct and descendant authority read/write, controller write, target write, and inbound/outbound network operations; status `0` (allowed) for direct and descendant designated-output writes; matching pre/post identities; child and sandbox status `0`; empty stderr; and `protectedPathMutationAttempts: 0`. The approved target configuration baseline for this run was `31222c942d8b751941e93769565ea0a8343480d08744a1074071e678c0cf4c9c`.

Authorization remains stopped. The original request and approval are preserved byte-for-byte; no proposal, digest, ledger, grant, cycle, pilot role, integration, target mutation, or push is part of this correction. Any future authorization must bind to a separately reviewed, accepted, and published release containing this fix.
