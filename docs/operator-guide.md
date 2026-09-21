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
/usr/local/bin/node src/cli.mjs checkpoint --state .runtime/controller/state.json --task TASK_ID
/usr/local/bin/node src/cli.mjs submit-result --state .runtime/controller/state.json --file .runtime/controller/result.json
/usr/local/bin/node src/cli.mjs show-summary --state .runtime/controller/state.json
/usr/local/bin/node src/cli.mjs migrate-state --state .runtime/controller/state.json --file .runtime/controller/migration.json
```

`next-task` renders the already-persisted task and expected result envelope. It does not create a task, launch Codex, or contact a provider. Role output is data-only JSON. The controller rejects duplicate JSON keys, unknown fields, identity drift, unapproved validation recipes, conflicting replays, arbitrary workspace paths, and arbitrary shell commands.

The rehearsal is fixture-only:

```sh
/usr/bin/sandbox-exec \
  -p '(version 1) (allow default) (deny network*)' \
  /usr/local/bin/node src/cli.mjs rehearse \
  --runtime .runtime/operator-rehearsal
```

Never point initialization or integration at the real target during Phase 2. `REAL_PILOT_NOT_AUTHORIZED` is intentional. Real human-operated role sessions additionally require independently verified host filesystem and network permissions before any later pilot activation; this checkpoint does not establish those permissions.

If checkpoint or integration status is uncertain, preserve the intent and observed state. Do not retry automatically. Exit code 2 denotes validation/policy refusal, 3 denotes hold/uncertainty, and 1 denotes an unexpected internal failure.
