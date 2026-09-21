# AI Agent Radar Offline Self-Improvement Controller

This repository is a dependency-free, local-only Phase 1 prototype. It simulates governance orchestration without launching Codex, contacting providers, publishing Git changes, sending notifications, or scheduling work.

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

Result: 46 tests, 46 passed, 0 failed. The suite preserves all original 32 behavioral cases and adds 14 direct regressions for runtime iteration bounds, source-authoritative queue ordering, canonical review/outbox transactions, descriptor and directory-sync durability, and real cross-process cycle admission. It includes an independent `sandbox_check` assertion for denied `network-outbound` and `network-inbound`. `scripts/test-offline.sh` performs the same denial check and never falls back to an unsandboxed command; `npm test` delegates to that wrapper.

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
