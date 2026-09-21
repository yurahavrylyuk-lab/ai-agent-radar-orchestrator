# GOV-002 Phase 2 Plan — Revision 1

## Objective

Add a dependency-free, human-assisted orchestration layer that produces durable, identity-bound handoffs while keeping every live capability disabled. The controller may exercise trusted Git checkpoint and integration components only against disposable fixture repositories.

## Approved Flow

1. Validate a bounded request and persist an Architect planning task.
2. Accept a strict, context-echoing Architect result and issue a Builder task.
3. Create a candidate only in the Builder’s registered independent workspace.
4. Verify the commit graph, exact pilot scope, file kind, modes, clean status, remotes, and alternates before recording a checkpoint receipt.
5. Issue an Analyst task bound to the immutable candidate.
6. Persist each review, iteration summary, simulated outbox event, and next task or hold atomically.
7. Require an independent `PASS` or `PASS_WITH_RECOMMENDATIONS` and a bound Architect `ACCEPT` before fixture integration.
8. Persist an integration intent, preserve candidate identity with an expected-old ref update, verify protected refs and the final worktree, then create one final summary.

## Fixed Boundaries

- Schema version 2; maximum three iterations; 900 seconds active role time; $0 additional cost.
- Network, providers, publication, scheduling, deployment, and real-target activation remain false.
- The only future pilot path is `docs/learning/offline-fixture-reading.md`, authorized as an ADD relative to the immutable baseline.
- No role result can supply executable commands or enable a capability.
- Unknown, conflicting, stale, ambiguous, or durability-uncertain state fails closed and creates or retains a hold.
- The authoritative AI Agent Radar target remains read-only during this checkpoint.
