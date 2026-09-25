# Human-Assisted Controller Operator Guide

Use Node.js 24 at `/usr/local/bin/node`. All controller state, fixture repositories, role workspaces, and evidence belong below the ignored `.runtime/` directory.

## Commands

```sh
/usr/local/bin/node src/cli.mjs init --state .runtime/controller/state.json --file .runtime/controller/init.json
/usr/local/bin/node src/cli.mjs enqueue --state .runtime/controller/state.json --file .runtime/controller/request.json
/usr/local/bin/node src/cli.mjs status --state .runtime/controller/state.json
/usr/local/bin/node src/cli.mjs next-task --state .runtime/controller/state.json
/usr/local/bin/node src/cli.mjs start-role --state .runtime/controller/state.json --task TASK_ID
/usr/local/bin/node src/cli.mjs finish-role --state .runtime/controller/state.json --task TASK_ID
/usr/local/bin/node src/cli.mjs prepare-workspace --state .runtime/controller/state.json --task TASK_ID --runtime .runtime/controller/workspaces
/usr/local/bin/node src/cli.mjs checkpoint --state .runtime/controller/state.json --task TASK_ID
/usr/local/bin/node src/cli.mjs submit-result --state .runtime/controller/state.json --file .runtime/controller/result.json
/usr/local/bin/node src/cli.mjs integrate-fixture --state .runtime/controller/state.json --cycle CYCLE_ID --target /absolute/path/to/disposable-fixture
/usr/local/bin/node src/cli.mjs show-summary --state .runtime/controller/state.json
/usr/local/bin/node src/cli.mjs migrate-state --state .runtime/controller/state.json --file .runtime/controller/migration.json
```

`next-task` renders the already-persisted task, a complete expected result envelope, exact execution context, and digest-bound actionable evidence. It does not create a task, launch Codex, or contact a provider. Copy the rendered handoff to the named human-operated role and submit the returned data-only JSON without rewriting its controller-owned identity fields.

Builder and Analyst roles must first use `prepare-workspace` for the exact pending task. Start and finish every role with the corresponding timing commands. Ordinary completion is rejected without a completed timing record, after more than 15 active minutes for one role, after more than 90 cumulative active minutes for the cycle, or while a hold is active. Human waiting is not active execution time. A timing violation may be closed only through the explicitly permitted `BLOCKED` disposition.

Builder and Analyst result templates contain the exact mandatory validation inventory, but never pre-fill an outcome. `PENDING_CHECKPOINT` means candidate identity is not ready. `AWAITING_ATTESTATION` means the checkpoint establishes only candidate identity—not recipe success. Perform each recipe, then select its complete `PASS` or `FAIL` entry from `attestationOptions`. The selected human-attested record is bound to repository, evidence mode, cycle, task, role, candidate, recipe, actual outcome, and the controller-verified checkpoint-identity digest. Do not remove, duplicate, substitute, or hand-edit these entries. `checkpoint` must succeed before Builder validation.

Builder completion and Analyst `PASS`/`PASS_WITH_RECOMMENDATIONS` require every mandatory recipe to have retained `PASS` evidence. Analyst `REVISE`, `REJECT`, or `HUMAN_REVIEW_REQUIRED` may retain genuine `FAIL` evidence so the failure and review can be persisted. Missing, skipped, unperformed, mismatched, or digest-invalid evidence always fails closed. Checkpoint metadata alone can never be submitted as recipe evidence.

`integrate-fixture` is available only after Architect acceptance and only for disposable fixtures whose target branch is exactly `self-improvement`. It is not a real-target activation mechanism. Non-`self-improvement` branches are rejected before a write intent or any Git mutation.

The controller rejects duplicate JSON keys, unknown fields, identity drift, unapproved validation recipes, conflicting replays, arbitrary workspace paths, and arbitrary shell commands. Every true terminal result receives exactly one final summary and simulated outbox event; a resumable reconciliation hold does not receive a premature final summary.

The rehearsal is fixture-only:

```sh
/usr/bin/sandbox-exec \
  -p '(version 1) (allow default) (deny network*)' \
  /usr/local/bin/node src/cli.mjs rehearse \
  --runtime .runtime/operator-rehearsal
```

Never point initialization or integration at the real target during Phase 2. `REAL_PILOT_NOT_AUTHORIZED` is intentional. Real human-operated role sessions additionally require independently verified host filesystem and network permissions before any later pilot activation; this checkpoint does not establish those permissions.

If checkpoint or integration status is uncertain, preserve the intent and observed state. Do not retry automatically. Exit code 2 denotes validation/policy refusal, 3 denotes hold/uncertainty, and 1 denotes an unexpected internal failure.

## Future activation-gate operation

The real-pilot commands are present for independent review but are not authorization to run a pilot:

```sh
/usr/local/bin/node src/cli.mjs authorize-pilot --state /absolute/protected/authority-state.json --file /absolute/request.json --approval-file /absolute/human-approval.json
/usr/local/bin/node src/cli.mjs show-authorization --state /absolute/protected/authority-state.json --authorization AUTHORIZATION_ID
/usr/local/bin/node src/cli.mjs integrate-local --state /absolute/protected/authority-state.json --cycle CYCLE_ID
```

Do not run these against the protected AI Agent Radar target until the activation-capable commit has passed independent Analyst review, received Architect `ACCEPT`, and been published normally to the exact approved `origin/main`. The eventual human operator must create the authority directory at `/Users/yuriy/Library/Application Support/AI Agent Radar Orchestrator/authority/` with mode `0700`; the controller intentionally does not provision it or change host permissions. The state file is created with mode `0600` by the trusted operator command. Real authority provenance is derived independently from that controller-owned canonical location and actual filesystem identity. Ledger path fields, recomputed digests, copied files, and rebound metadata cannot substitute another source. Disposable stores are test-only and cannot authorize the protected target.

The operator must run `authorize-pilot` from the reviewed controller `main` checkout in an interactive terminal. It validates the complete request, target snapshots, Git-directory identity, exact sole controller remote and upstream, and local OS boundary proof; displays the complete proposed grant and digest; and accepts only the exact `CONFIRM <authorizationDigest>` response. Target index identity is the versioned semantic evidence `git-index-semantic-v1`: exact raw-path/mode/object/stage entries must equal `HEAD`, every stage must be zero, flags must be ordinary, and the cached diff must be empty. A raw index hash is displayed only as diagnostic evidence because stat-cache refreshes may change bytes without changing semantics. There is no `--yes`, `--now`, environment approval, or role-issued grant path. The exact human statement is request-specific and is displayed as part of the proposal.

Every Architect, Builder, and Analyst process and descendant must be launched by the human under the reviewed `sandbox-exec` role profile. That profile denies all network access, denies authority-store reads and writes, denies controller and authoritative-target writes, and allows only the designated role-output/workspace path. File mode `0700` alone is not an adequate boundary for same-user processes. The controller renders the required boundary mechanism and policy digest in each activation task but never launches a role automatically.

`integrate-local` accepts only `--state` and `--cycle`; target, branch, candidate, and commit overrides are forbidden. It requires no active human or reconciliation hold, the exact active cycle in `REVIEW/AWAITING_INTEGRATION`, a claimed unused grant, complete successful validation attestations, an eligible independent Analyst result, and the exact matching Architect `ACCEPT`. These conditions, canonical authority provenance, and target identity are checked before intent and again under both the authoritative state lock and exclusive target lock immediately before ref mutation. Late worktree, index, mode, configuration, identity, ref, or evidence drift prevents the ref update.

Integration imports only the reviewed local candidate objects and performs one expected-old update of `refs/heads/self-improvement`. It does not reset, check out, restore, clean, replace the index, or reconstruct the worktree. After success, symbolic `HEAD` still names `refs/heads/self-improvement`, and the branch resolves to the exact candidate, but the index and worktree intentionally remain at the pre-integration baseline. For the approved one-file ADD, `git status --porcelain=v1` therefore reports `D  docs/learning/offline-fixture-reading.md`; the file is absent from the preserved checkout, and the checkout is not clean or synchronized with the new branch tip. The recorded `REF_ADVANCED_CHECKOUT_PRESERVED` evidence contains both the pre-integration baseline and post-ref state. Any later synchronization requires a separate explicit human-controlled operation; this controller provides no automatic synchronization command.

No remote push occurs. Once durable intent exists, any uncertainty—including uncertainty after the ref update—enters reconciliation and must not be rolled back or retried automatically.

The authority ledger retains issued, closed, reconciliation, and consumed history. Confirmed replay returns stored evidence without a second mutation. Notification delivery is still simulated, and the runtime has no provider, publication, scheduling, paid-execution, or GitHub-credential capability.
