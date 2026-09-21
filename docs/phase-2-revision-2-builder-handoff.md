# GOV-002 Phase 2 Revision 2 Builder Handoff

## Status and Provenance

Builder/Analyst implementation iteration 2 is ready for independent Analyst review. It is not Architect-accepted, not GOV-002 complete, and not authorized for real-pilot activation.

- Revision 1 Builder checkpoint: `c91e9ce37d52d676ead277dcb2492fd47aad4d77`.
- Revision 1 independent Analyst result: `PASS` (preserved as historical evidence).
- Revision 1 Architect result: `REVISE`.
- Revision 2 scope: only the six Architect corrections, their regression coverage, and this operator handoff.

## Six Corrected Findings

1. **Public CLI lifecycle:** `prepare-workspace` prepares the exact pending Builder or Analyst workspace, and `integrate-fixture` completes only an accepted disposable fixture cycle. A subprocess-only test drives init through final summary entirely through supported CLI commands.
2. **Self-contained prompts:** role handoffs include the complete response payload template, allowed outcomes, execution workspace and commit identities, scope, validation requirements, and digest-bound evidence content. Architect revision and final-decision prompts include the applicable Analyst findings, required changes, conclusion, and recommendations.
3. **Required validation evidence:** every mandatory recipe must appear exactly once with an allowed outcome and resolvable successful evidence. Evidence is bound to schema, repository, cycle, task, role purpose, candidate, checkpoint receipt and digest, candidate tree, scope digest, and recipe. Empty, missing, duplicate, unknown, wrong-digest, and other-candidate sets fail closed.
4. **Timing and holds:** ordinary submissions require a completed and internally consistent timing record, no active hold, no role execution above 900 seconds, and no cycle active execution above 5,400 seconds. Human waiting is excluded. Idempotent replay remains available while held, and an explicitly permitted timed disposition can close the cycle.
5. **Terminal summaries:** successful integration, Architect rejection, Architect human review, terminal `BLOCKED`, and iteration-limit escalation each atomically produce exactly one immutable deterministic final summary and simulated final outbox event. Replay does not duplicate either record. Resumable reconciliation remains a hold without a premature final summary.
6. **Exact branch policy:** admission, task/state validation, integration intent validation, and the integration component require `self-improvement`. Real Git regressions prove `main` and another arbitrary branch fail before ref, index, worktree, status, or integration-intent mutation.

## Verification

- Mandatory command: `/bin/sh scripts/test-offline.sh`.
- Native sandbox policy: `(version 1) (allow default) (deny network*)`.
- Network gate: both `network-outbound` and `network-inbound` denied with result `1`.
- Complete suite: 90 tests passed; 0 failed, skipped, cancelled, or todo.
- Public CLI lifecycle: REVISE → PASS → ACCEPT and fixture-only integration completed using CLI subprocesses only; the disposable fixture `main` ref and clean status were preserved.
- Validation regressions: empty, missing, duplicate, unknown, wrong-digest, other-candidate evidence were rejected; the exact checkpoint-backed set was accepted.
- Timing regressions: missing/open timing, more than 15 active role minutes, and more than 90 cumulative active cycle minutes were rejected; human wait was excluded; replay and the bounded disposition behavior were preserved.
- Terminal regressions: `BLOCKED`, `REJECT`, `HUMAN_REVIEW`, iteration-limit escalation, and successful integration have one final summary/outbox identity each.
- Branch regressions: `main` and arbitrary branch integration attempts produced no Git or intent mutation.

## Deterministic Rehearsal

- Cycle: `cycle:rehearsal-request`.
- Candidate 1: `4811991ad8a937a11afc6d7cc92b55e053bb47ed`.
- Candidate 2 and fixture integration identity: `290d768dc2166bd19edac07b2b19b2a3cbf9f060`.
- Iteration summary 1: `summary:cycle:rehearsal-request:iteration:1`.
- Iteration summary 2: `summary:cycle:rehearsal-request:iteration:2`.
- Final summary: `summary:cycle:rehearsal-request:final`.
- Final summary digest: `05983aafc11cd1d1c7e3fd64e14844f78ca4ada6d099d76dc8e9e42da0514540`.

The rehearsal was executed under the same network-denial policy and used only a disposable fixture. Its evidence remains ignored runtime data, not source material.

## Protected Target Preservation

The deterministic Node hashing procedure from revision 1 remains authoritative: non-ignored paths from `git ls-files -co --exclude-standard -z` are deduplicated, lexically sorted, required to be regular files, SHA-256 hashed with built-in `node:crypto`, and serialized exactly as `JSON.stringify(records, null, 2) + "\n"`.

The pre-commit comparison found 75 files with manifest SHA-256 `8b64f934c5bef4a8dc43e406f9cfbbba243e43497e3b91990f762c2366b52629`. Modes, symbolic branch `self-improvement`, HEAD `33a60a1f74960f9c171f5449627db1be362c6481`, protected refs, empty status, Git config, and index match the retained baseline. `docs/learning/offline-fixture-reading.md` remains absent.

## Capability Boundary and Remaining Limitations

No dependency, lockfile, provider API, OpenAI, Gemini, Brave, Resend, email, Cloudflare, D1, scheduler, deployment, publication, remote, secret handling, automatic Codex launch, or paid execution capability was added. The controller still has no remote. Human-assisted execution remains manual and non-launching. The real pilot remains disabled.

The controller is an offline governance prototype. It still requires human role execution and independent Analyst and Architect review. Fixture-only integration evidence cannot authorize or substitute for a real-target pilot. The exact revision-2 commit is returned separately after final verification so this document does not require self-amendment.
