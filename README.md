# AI Agent Radar Offline Self-Improvement Controller

This repository is a dependency-free, local-only governance controller. Phase 1 established the fail-closed offline prototype; GOV-002 Phase 2 adds human-assisted, data-only role handoffs and trusted Git operations that are enabled only for disposable fixture repositories. It does not launch Codex, contact providers, publish Git changes, send notifications, schedule work, or activate the real pilot.

## Phase 2 Revision 1

- Accepted parent checkpoint: `6e31a14cbe655640c8fdeee5b2117c14aad095e0`.
- New orchestration schema version: 2, while version-1 validation remains available.
- CLI: `status`, `next-task`, `submit-result`, `show-summary`, `start-role`, `finish-role`, `init`, `enqueue`, `prepare-workspace`, `checkpoint`, `integrate-fixture`, `rehearse`, and `migrate-state`.
- Strict role tasks bind controller/repository/cycle/task identities, authorization, immutable plan and prior evidence, fixed model metadata, capability limits, and a canonical SHA-256 digest.
- Strict role results exactly echo controller context. Accepted results receive durable receipts; exact replay is idempotent and conflicting replay fails closed.
- Human handoffs are persisted and rendered but never launched automatically.
- Builder and Analyst workspaces are independent local Git copies with no remotes, alternates, credentials, inherited hooks, shared metadata, or network capability.
- Trusted checkpointing verifies a single-parent linear history, exact per-iteration and cumulative pilot scope, regular non-executable mode, and clean workspace state.
- Trusted integration is implemented and tested only for disposable fixtures. It writes an intent before an expected-old ref update and preserves the reviewed commit ID. Uncertainty requires reconciliation and prohibits retry.
- Explicit v1-to-v2 migration preserves the exact legacy bytes and SHA-256 digest; reads never migrate implicitly.
- The real target gate is fixed false and returns `REAL_PILOT_NOT_AUTHORIZED`.

The approved simulated rehearsal is:

```text
Architect plan
→ Builder candidate 1
→ Analyst REVISE
→ iteration summary 1
→ Architect revision
→ Builder candidate 2
→ Analyst PASS
→ iteration summary 2
→ Architect ACCEPT
→ fixture-only integration
→ final summary
```

## Phase 2 Revision 2

Revision 1 checkpoint `c91e9ce37d52d676ead277dcb2492fd47aad4d77` received an independent Analyst `PASS`, followed by an Architect `REVISE`. The historical Analyst result remains part of the evidence chain; revision 2 does not replace it or claim Architect acceptance.

Revision 2 addresses only the six Architect findings:

1. Public `prepare-workspace` and fixture-only `integrate-fixture` commands complete the supported operator lifecycle without internal imports or manual state editing.
2. Rendered role prompts contain the expected response payload, workspace/commit/scope details, validation requirements, and digest-bound actionable preceding evidence.
3. Builder and Analyst results require an exact complete set of checkpoint-backed validation evidence; missing, duplicate, unknown, unresolvable, or context-mismatched evidence fails closed.
4. Result submission independently enforces completed timing, the 15-minute role limit, the 90-minute active-cycle limit, and active holds while excluding human waiting.
5. Every true terminal outcome atomically creates one deterministic final summary and simulated final outbox event; resumable reconciliation holds do not.
6. Admission, persisted state validation, and fixture integration all require the exact `self-improvement` branch before Git mutation.

The full public lifecycle is exercised by a subprocess-only CLI test. The complete revision-2 suite contains 90 offline tests and runs only through `scripts/test-offline.sh` under native inbound and outbound network denial. See [the revision-2 Builder handoff](docs/phase-2-revision-2-builder-handoff.md) for the exact evidence. GOV-002 Phase 2 remains pending independent Analyst and Architect review.

## Phase 2 Revision 3

Revision 2 checkpoint `02632a283f50847a81bce3c3466bf73c9f2ce4e2` received an independent Analyst `PASS`, followed by an Architect `REVISE`. The Architect confirmed the public CLI, prompt, timing, terminal-summary, and branch-safety findings closed, but identified one remaining blocker: checkpoint identity evidence incorrectly synthesized recipe `PASS` outcomes.

Revision 3 separates controller-verified checkpoint identity from role-attested recipe outcomes. A checkpoint now establishes only candidate, tree, scope, workspace receipt, and repository/task binding. Each required recipe remains `AWAITING_ATTESTATION` until the role explicitly selects a digest-bound `PASS` or `FAIL` record. Positive Analyst review and Builder completion require every recipe to pass; a negative Analyst review can durably retain genuine failures and proceed through the REVISE loop. Integration independently revalidates the latest successful Analyst evidence before any write.

The complete revision-3 suite contains 93 offline tests. Its public CLI lifecycle and deterministic rehearsal both demonstrate `FAIL → Analyst REVISE → iteration summary → Architect revision → corrected candidate → PASS → ACCEPT` using persisted evidence. See [the revision-3 Builder handoff](docs/phase-2-revision-3-builder-handoff.md). GOV-002 Phase 2 still awaits independent Analyst review and Architect disposition.

## Real-pilot activation gate revision 1

The activation gate adds a separate authority-state version for a future, single bounded `HUMAN_ASSISTED` pilot. It does not activate that pilot. An immutable grant binds the reviewed and published controller release, exact controller remote policy, protected authority-store identity, request digest, target root/Git directory/branch/baseline/snapshots, fixed one-file scope, validation policy, and a single integration permission. Mutable claim and integration lifecycle data is retained separately in one ledger.

The trusted public commands are `authorize-pilot`, `show-authorization`, and `integrate-local`. Authorization has no `--yes`, environment-variable, fixture, or role-result shortcut; it requires the exact human statement and digest-specific interactive confirmation. Real admission atomically claims the grant with one cycle and task. Trusted integration derives its target, branch, candidate, and grant from protected state, writes durable intent before Git mutation, preserves the independently reviewed candidate commit, and never pushes.

Roles remain data-only human handoffs. The mandatory wrapper proves native macOS filesystem denial for authority-store reads/writes and controller/target writes, including descendants, while the complete suite runs with inbound and outbound network denial. Notification remains simulated. Provider, publication, scheduling, paid fallback, automatic role launch, and target-remote operations remain unavailable.

The proposed production authority location is `/Users/yuriy/Library/Application Support/AI Agent Radar Orchestrator/authority/`, but this implementation does not create or provision it. Real use requires later human setup after independent Analyst review, Architect acceptance, normal publication of the exact accepted controller commit, and a fresh authorization bound to that published commit. See [the activation-gate plan](docs/activation-gate-plan.md), [operator guide](docs/operator-guide.md), and [Builder handoff](docs/activation-gate-builder-handoff.md).

Run it only under the network-denial boundary documented below:

```sh
/usr/bin/sandbox-exec \
  -p '(version 1) (allow default) (deny network*)' \
  /usr/local/bin/node src/cli.mjs rehearse \
  --runtime .runtime/manual-rehearsal
```

## Approved Plan

- Cycle: `GOV-002`
- Phase: `1`
- Plan revision: `4`
- Builder/Analyst iteration: `2`
- Previous reviewed commit: `7bec111cc246c17d39ecb6eaadea5834bb9ff4ad`
- Real task status: `REVIEW`
- Previous Analyst result: `REVISE`
- Previous Architect result: `REVISE`
- New Analyst review: pending
- New Architect acceptance: pending
- Target repository: `/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent`
- Controller repository: `/Users/yuriy/Documents/IT Study/General/General/AI Agents/ai-agent-radar-orchestrator`

Fixed policy:

- Zero additional paid spend.
- `liveOperationsEnabled = false`.
- `schedulingEnabled = false`; schedule metadata only: `0 8 * * 1,3,5`.
- Architect: Astra High; Builder: Sol Medium; Analyst: Terra High.
- No model fallback.
- Maximum three Builder/Analyst iterations.
- Maximum 15 active minutes per simulated role and 90 active minutes per simulated cycle.
- One active cycle and one authoritative local controller.

The target allowlist is a simulated policy contract, not permission to modify the target. Only regular-file ADD/MODIFY operations in the documented learning and offline-test namespaces are eligible; protected paths and unsafe filesystem operations always win.

## Architecture and Safety

- JSON schemas and runtime validators reject unknown fields, iteration indices outside `1..3`, excess/duplicate iterations, and invalid cross-record identities without limiting plan revisions.
- Human requests are ordered before scheduled requests regardless of caller-supplied priority; validated submission time and stable ID provide deterministic ordering.
- Local ownership generations, state versions, ownership-bound lock release, real cycle admission, atomic lock acquisition, and atomic file replacement fail closed.
- Human holds remain durable and block new cycle admission; stale locks are never taken over automatically.
- Reviews, summaries, and canonically hashed outbox events are validated as one state transaction; duplicate payloads are idempotent, notification outcomes are preserved, and conflicts cannot alter persisted bytes.
- State replacement uses an exclusive temporary file, file sync and close, atomic rename, then parent-directory sync and close. A pre-rename failure preserves the old state; a post-rename sync failure is reported as durability uncertainty and is never retried automatically.
- Human-assisted dispatch returns `AWAITING_HUMAN_ROLE` and never launches an AI process.
- Paid execution always returns `PAID_EXECUTION_FORBIDDEN` without inspecting credentials or reserving capacity.
- Git, model, quota, clock, and notifier adapters are fake. No live adapter exists.
- Simulated records are explicitly labeled and are kept separate from this real Builder handoff.

## Offline Verification

Node runtime: `v24.18.0` at `/usr/local/bin/node`.

Exact suite invocation:

```sh
cd '/Users/yuriy/Documents/IT Study/General/General/AI Agents/ai-agent-radar-orchestrator'

/usr/bin/sandbox-exec \
  -p '(version 1) (allow default) (deny network*)' \
  /usr/local/bin/node \
  --test \
  --test-concurrency=1 \
  test/*.test.mjs
```

Phase 1 result: 46 tests, 46 passed, 0 failed. Phase 2 preserves all 46 assertions and expands the same network-denied suite with contract, lifecycle, replay, concurrency, migration, real local Git, uncertainty, CLI, snapshot, and rehearsal coverage. The final Builder handoff records the current total. The suite includes an independent `sandbox_check` assertion for denied `network-outbound` and `network-inbound`. `scripts/test-offline.sh` performs the same denial check and never falls back to an unsandboxed command; `npm test` delegates to that wrapper.

Revision 4 target preservation uses a new Node-only SHA-256 manifest stored in a Builder-owned `/private/tmp/gov002-r4-builder.*` directory. The script obtains non-ignored paths from `git -c core.optionalLocks=false ls-files -co --exclude-standard -z`, sorts paths lexically, requires each entry to be a regular file, and records `{ path, sha256 }` objects. Exact serialization is `JSON.stringify(records, null, 2) + "\\n"`, written with mode `0600`. The post-build file must compare byte-for-byte with the pre-build file, alongside unchanged Git refs and status.

The earlier manifest serialization was not reconstructed or corrected during revision 4. The previously reported count of 75 regular files remains a historical observation, not a hardcoded inventory or evidence of target mutation.

## Revision History

- Revision 1 created the dependency-free offline controller prototype, schemas, fake adapters, durability policies, and original 32-case suite.
- Revision 2 replaced an unavailable hashing utility with the approved Node `crypto` procedure and repaired the pre-review helper filesystem path and retention callback tests.
- Revision 3 completed pre-review verification and produced local checkpoint `7bec111cc246c17d39ecb6eaadea5834bb9ff4ad`.
- Revision 4 addresses the independent Analyst and Architect `REVISE` findings: runtime iteration enforcement, source-authoritative queue ordering, unified outbox/review validation, real locked cycle admission, and explicit durable replacement semantics.

## Builder Handoff

- Source structure is limited to the approved README, package/config/schema/source/test/script files.
- Validation performed: mandatory sandbox policy check; complete 46-test offline suite; wrapper verification; source inventory; staged-diff and whitespace checks; secret/artifact/live-adapter audit; local-only Git audit; and revision-4 pre/post target manifest, refs, and status comparison.
- Revision-4 correction scope is limited to the reviewed iteration, queue, outbox/review, admission, persistence-durability, tests, bounded schema, and handoff metadata findings.
- Dependencies/downloads: none.
- External calls, provider calls, publication, deployment, or active scheduling: none.
- Durability limitation: the implementation reports success only after the tested macOS filesystem accepts both file and parent-directory `fsync`. A post-rename error is reported as uncertain because the new state may be visible without established directory durability; no stronger filesystem or hardware guarantee is claimed.
- Other limitations: this is an offline policy and durability prototype. It cannot launch Codex, use paid capacity, modify or publish the target, send real notifications, or run a real schedule.
- Deviations: none after the authorized revision-4 corrections.
- Local checkpoint: created only after all final checks; the exact commit SHA is returned to the Analyst after creation.

Stop condition: independent Analyst review of the exact local commit. GOV-002 is not COMPLETE, and no automation is active.

## Phase 2 Builder Evidence

The Phase 2 target baseline uses the same Node-only hashing method: paths come from `git ls-files -co --exclude-standard -z`, are deduplicated and lexically sorted, each supported regular file is hashed with built-in `node:crypto` SHA-256, and the exact manifest bytes are `JSON.stringify(records, null, 2) + "\n"`. The ignored Builder evidence directory is `.runtime/phase2-r1-builder-evidence`; modes, symbolic HEAD, refs, status, Git config, and index are compared separately.

The Phase 1 Analyst `PASS` and Architect `ACCEPT` are recorded only as provenance supplied by the human-authored Phase 2 instruction. This Builder does not claim an independent Phase 2 review. See [Phase 1 acceptance](docs/phase-1-acceptance.md), [Phase 2 plan](docs/phase-2-plan.md), [operator guide](docs/operator-guide.md), and [Builder handoff](docs/phase-2-builder-handoff.md).
