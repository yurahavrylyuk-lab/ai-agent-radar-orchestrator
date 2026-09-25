# GOV-002 Real-Pilot Activation Gate Revision 3

## Purpose

This capability makes one narrowly scoped future pilot technically admissible only after an exact trusted human authorization. It does not activate the pilot, provision production authority, launch roles, call providers, publish Git changes, or mutate the protected target during implementation.

## Trust boundary

- The human runs the reviewed controller CLI outside role sandboxes.
- Real-target authority is accepted only from the controller-owned canonical root `/Users/yuriy/Library/Application Support/AI Agent Radar Orchestrator/authority/`. That provenance is derived from trusted policy and the actual filesystem path, never from ledger fields or their digest.
- Disposable authority stores are explicitly test-scoped, must remain below the OS temporary root, and can never authorize the protected real target.
- Role processes receive immutable rendered tasks and return data-only result files.
- Native macOS sandbox policy denies role network access, authority-store reads/writes, controller writes, authoritative-target writes, and the same operations by descendants.
- The trusted operator process alone accepts results and performs a separately requested local integration after all evidence gates pass.

## Fixed first-pilot grant

- Evidence: `HUMAN_ASSISTED`.
- Branch: `self-improvement`.
- Baseline: `33a60a1f74960f9c171f5449627db1be362c6481` for the eventual real authorization.
- Change: one regular non-executable ADD at `docs/learning/offline-fixture-reading.md`.
- Limit: 800 words and at most three Builder/Analyst iterations.
- Required meaning: fictional, offline, non-governance, non-production, and non-operational.
- Forbidden meaning: credentials, secrets, provider instructions, deployment instructions, and billing instructions.
- Spend: included subscription capacity only, with no paid fallback.
- Integration permission: one successful local integration and no target remote push.

The immutable version-2 grant digest covers human approval provenance, reviewed controller commit/tree/origin, authority-store identity, repository and target identities, request digest, target snapshots and protected refs, fixed scope, limits, and issuance time. Raw `.git/index` SHA-256 is retained only as `rawIndexDigestDiagnostic`; it is not a preservation decision. The normative `semanticIndex` evidence is explicitly versioned `git-index-semantic-v1`. Raw-index-only version-1 grants are incompatible and rejected rather than converted. Lifecycle metadata is separate: `ISSUED → CLAIMED → INTEGRATING → CONSUMED`, with terminal `CLOSED` and `RECONCILIATION_REQUIRED` states. A claim and its initial cycle/task are one atomic transaction.

## Remote and target policy

The controller requires one remote named `origin`, exact fetch and effective push URL `https://github.com/yurahavrylyuk-lab/ai-agent-radar-orchestrator.git`, branch `main`, upstream `origin/main`, no URL rewrite, and a published linear local release. Runtime performs local configuration inspection only and has no publication command.

Real admission rechecks controller cleanliness, policy-derived authority provenance, exact request/grant binding, target root and Git-directory identity, self-improvement and production refs, clean tracked/index/untracked state, safe path ancestors, pilot-path absence, deterministic manifest/modes/config/semantic-index snapshots, controller availability, and the absence of unresolved intents. Semantic index acceptance requires exact path/mode/object/stage equality with `HEAD`, stage zero only, ordinary flags only, and an empty cached diff. Fabricated, copied, or rebound ledger metadata cannot redefine the trusted authority source.

## Local integration and uncertainty

`integrate-local` derives all mutation identities from protected state. Before intent it rejects a human hold, unresolved checkpoint or integration reconciliation, wrong active cycle, wrong status/stage, stale candidate, stale Analyst review, stale Architect acceptance, and stale successful validation evidence. It persists a version-4 intent containing the exact pre-integration checkout baseline, then imports only the reviewed local objects. Immediately before ref mutation, while holding both the exclusive target lock and authoritative state lock, it revalidates the exact intent, grant, cycle, review evidence, controller identity, target identity, protected refs, semantic index, manifest, modes, configuration, clean status, and pilot-path absence.

Real integration is ref-only. The sole authorized ref mutation is an expected-old update of `refs/heads/self-improvement` from the approved baseline to the exact reviewed candidate. The operation does not run `read-tree --reset -u`, reset, checkout, restore, clean, index replacement, or any equivalent worktree reconstruction. It verifies the one-file ADD from commit/tree evidence rather than by synchronizing the checkout.

A successful outcome records the versioned condition `REF_ADVANCED_CHECKOUT_PRESERVED`. Symbolic `HEAD` remains `refs/heads/self-improvement`, that branch ref and `HEAD` resolve to the candidate, while the semantic index, worktree manifest, modes, configuration, and repository identity remain equal to the pre-integration baseline. The index intentionally does not equal the new `HEAD`; for the authorized ADD, porcelain status is exactly a staged deletion of `docs/learning/offline-fixture-reading.md` because the file remains absent from the preserved checkout. This is not a clean or synchronized checkout. Any later synchronization is a separate human-controlled action and is not implemented here.

A confirmed completed replay returns the stored result. Any uncertainty after durable intent creates a reconciliation hold; there is no automatic rollback, retry, replacement authorization, or replacement cycle. Negative terminal role outcomes close the claimed authorization and produce one immutable `HUMAN_ASSISTED` final summary. All notification records remain simulated.

## Verification plan

- Use only disposable controller, target, authority, and workspace roots.
- Run the complete test inventory only through `/bin/sh scripts/test-offline.sh`.
- Prove denied inbound/outbound network operations and direct/descendant filesystem operations under native sandbox enforcement.
- Run the full public CLI lifecycle without internal imports or manual state editing.
- Exercise forged, altered, copied, rebound, changed, replayed, concurrent, held, stale-evidence, late-worktree/index/mode/config drift, invalid-target, and post-ref uncertainty paths.
- Prove exact candidate identity, ref-only advancement, unchanged pre-integration index/worktree evidence, and the precise intentionally unsynchronized status.
- Compare the protected AI Agent Radar target’s pre/post Node SHA-256 manifest, modes, refs, config, semantic index, status, and pilot-path absence. Raw index hashes are diagnostic only.

The target manifest method is deterministic and dependency-free: enumerate non-ignored tracked/untracked paths with `git -c core.optionalLocks=false ls-files -co --exclude-standard -z`; deduplicate and sort lexically; require regular files; hash bytes with Node `crypto` SHA-256; serialize as `JSON.stringify(records, null, 2) + "\n"`. Evidence remains in a Builder-owned temporary directory outside both repositories.

Semantic index inspection uses sanitized Git environment variables, `GIT_OPTIONAL_LOCKS=0`, `GIT_NO_LAZY_FETCH=1`, `LC_ALL=C`, `/usr/bin/git --no-optional-locks`, and transiently disables fsmonitor and the untracked cache. NUL-delimited paths remain Buffers. Entries are sorted with `Buffer.compare` and serialized exactly as `JSON.stringify({ format: "git-index-semantic-v1", entries }) + "\n"`, where each entry is `{ pathBase64, mode, oid, stage: 0 }`.

## Activation prerequisites not performed here

1. Independent Analyst review of the exact local Builder checkpoint.
2. Architect `ACCEPT` for that exact checkpoint.
3. Normal fast-forward publication to the approved controller `origin/main`.
4. Human creation of the production authority directory with the documented mode and role sandbox boundary.
5. A new interactive authorization bound to the future published activation-capable commit.

Until all five occur, there is no real grant and no authorized real pilot.
