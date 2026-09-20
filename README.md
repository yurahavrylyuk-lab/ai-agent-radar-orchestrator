# AI Agent Radar Offline Self-Improvement Controller

This repository is a dependency-free, local-only Phase 1 prototype. It simulates governance orchestration without launching Codex, contacting providers, publishing Git changes, sending notifications, or scheduling work.

## Approved Plan

- Cycle: `GOV-002`
- Phase: `1`
- Plan revision: `2` (bounded repair and completion of the approved revision-1 implementation)
- Real task status: `REVIEW`
- Analyst result: pending
- Architect acceptance: pending
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

- JSON schemas and runtime validators reject unknown fields and invalid cross-record identities.
- Local ownership generations, state versions, atomic lock acquisition, and atomic file replacement fail closed.
- Human holds remain durable and block new cycle admission; stale locks are never taken over automatically.
- Reviews, summaries, and outbox events are composed as one state transaction; duplicate payloads are idempotent and conflicts are rejected.
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

Result: 32 tests, 32 passed, 0 failed. The suite includes an independent `sandbox_check` assertion for denied `network-outbound` and `network-inbound`. `scripts/test-offline.sh` performs the same denial check and never falls back to an unsandboxed command; `npm test` delegates to that wrapper.

Target preservation uses a Node-only SHA-256 manifest. A Node 24 script obtains non-ignored paths from `git -c core.optionalLocks=false ls-files -co --exclude-standard -z`, requires every entry to be a regular file, hashes contents with built-in `node:crypto`, sorts paths deterministically, and writes the manifest into a Builder-owned `/private/tmp/gov002-builder-rev2.*` directory. No Python or external hashing dependency is used. The post-build manifest must exactly equal the pre-build manifest, alongside unchanged Git refs and status.

## Builder Handoff

- Source structure is limited to the approved README, package/config/schema/source/test/script files.
- Validation performed: mandatory sandbox policy check; complete 32-case offline suite; wrapper verification; source inventory; staged-diff and whitespace checks; secret/artifact/live-adapter audit; local-only Git audit; pre/post target manifest, refs, and status comparison.
- Repair applied after the first test run: Case 17 converts the test module URL with `fileURLToPath` before constructing the helper filesystem path; Case 31 uses `.map(value => structuredClone(value))`.
- Dependencies/downloads: none.
- External calls, provider calls, publication, deployment, or active scheduling: none.
- Limitations: this is an offline policy and durability prototype. It cannot launch Codex, use paid capacity, modify or publish the target, send real notifications, or run a real schedule.
- Deviations: none after the authorized revision-2 repairs.
- Local checkpoint: created only after all final checks; the exact commit SHA is returned to the Analyst after creation.

Stop condition: independent Analyst review of the exact local commit. GOV-002 is not COMPLETE, and no automation is active.
