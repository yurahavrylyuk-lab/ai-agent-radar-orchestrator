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

Builder and Analyst result templates contain the exact mandatory validation entries. Each successful entry is bound to the repository, cycle, task, candidate, recipe, and retained checkpoint evidence. Do not remove, duplicate, substitute, or hand-edit these entries. `checkpoint` must succeed before submitting a Builder result.

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
