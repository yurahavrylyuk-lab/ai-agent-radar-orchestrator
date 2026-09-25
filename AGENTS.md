# AI Agent Radar Orchestrator operating policy

Applies repository-wide to Architect, Builder, Analyst, and human-operated
controller work.

## Authority and evidence

This file consolidates the accepted operating policy. It does not grant
permission to publish, provision authority, issue authorization, or run a pilot.

Accepted activation-gate implementation:
d04220c5bd7ba13be5428b84b1d86e6aa980fb7d.

Read this file, the applicable approved plan, the operator guide, the latest
Builder handoff, and the independent Analyst review before work.

Current activation behavior is documented in:

* docs/activation-gate-plan.md
* docs/operator-guide.md
* docs/activation-gate-builder-handoff.md

Historical README sections and old handoffs are historical evidence, not
current execution permission. Preserve their provenance.

Reconcile instructions, accepted decisions, schemas, and implementation.
Report conflicts and stop affected work; do not resolve them by silently
changing runtime behavior or weakening a safety boundary. Existing code is
evidence of behavior, not automatic authorization for that behavior.

Bind plans, reviews, acceptance, and publication to exact commits and revisions.
Distinguish observed facts, role attestations, simulations, and assumptions.
Never invent verification results or overwrite another role's evidence.

## Roles and handoff

Permanent handoff:
Human → Architect → Builder → Analyst → Architect → Human.

ARCHITECT:

* Analyze the request and define one bounded improvement.
* Specify baseline, allowed paths, exclusions, risks, acceptance criteria,
  verification, and required human decisions.
* Review the exact Builder checkpoint and independent Analyst findings.
* Disposition ACCEPT, ACCEPT WITH RECOMMENDATIONS, REVISE, REJECT, or
  HUMAN REVIEW REQUIRED using the applicable review protocol.
* Do not implement while acting as Architect.
* Acceptance does not itself authorize publication, target integration,
  production merge, provisioning, or deployment.

BUILDER:

* Implement only explicitly approved scope in the authorized repository or
  registered workspace.
* Preserve unrelated work and independent review records.
* Run required validation and report actual results, skipped checks, deviations,
  changed paths, and the exact checkpoint.
* Do not weaken tests, broaden permissions, or fix unrelated issues.
* Commit only when the task explicitly authorizes a checkpoint.
* Stop for independent review; do not self-approve or publish by implication.

ANALYST:

* Independently review the exact checkpoint, parent, diff, evidence, and scope.
* Verify correctness, safety boundaries, regressions, and acceptance criteria.
* Record findings without fixing implementation or rewriting Builder evidence.
* A positive Analyst result requires a separate Architect disposition.

During real-pilot execution, roles are human-launched, data-only handoffs.
Roles cannot issue authority, edit the authority ledger, mutate the authoritative
target, or invoke trusted integration as a substitute for the human operator.
Preserve controller-owned task identities and validation bindings.

Controller maintenance is a separate explicitly scoped task. It does not
inherit real-pilot authority or permit bypassing a role sandbox.

## Git and publication

Distinguish the repositories:

* This orchestrator uses main for its accepted controller release.
* AI Agent Radar main is production.
* AI Agent Radar self-improvement is the sole permitted experimental target
  branch for the bounded pilot.

Approved orchestrator remote:
origin
https://github.com/yurahavrylyuk-lab/ai-agent-radar-orchestrator.git

Publication is a separate authorized human-operated step, never a controller
runtime capability or an implicit Builder responsibility.

Before publication verify exact accepted HEAD, clean index/worktree, sole
approved fetch/push URL, upstream origin/main, fresh expected remote tip,
and the approved linear fast-forward history. Stop on any mismatch.

Use normal fast-forward publication only. No force, force-with-lease, amend,
rebase, squash, merge commit, or history rewrite of reviewed checkpoints.
After publication verify local main and remote main equal the accepted commit.

Do not push the protected target or merge it into production main.
Keep this governance change separate from the accepted activation-gate commit.

## Limits and prohibited capabilities

Preserve the accepted limits:

* One active cycle and one authoritative controller.
* At most three Builder/Analyst iterations; do not evade this with replacement
  requests, cycles, or authorizations.
* 15 active minutes per role and 90 cumulative active minutes per cycle.
  Human waiting is excluded.
* Zero additional paid execution; included subscription capacity only.
* No paid fallback, model fallback, or automatic role launch.

Do not introduce or invoke live provider, email, deployment, scheduling,
publication, credential, or billing adapters.
Do not change Cloudflare, production Cron, provider quotas, secrets, or
production behavior under governance or pilot authorization.

Role outcomes and validation attestations must be truthful. A checkpoint
proves candidate identity, not successful execution of validation recipes.
Preserve failed validation evidence and use the permitted blocked/review flow.

## Protected target and inspection

Protected repository:
/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent

First-pilot baseline:
self-improvement = 33a60a1f74960f9c171f5449627db1be362c6481
main = 3a6946fe07ea3838488c789cba4c69718b2ed328

Outside the separately authorized integration operation, treat the target
as read-only. Never reset, repair, clean, restore, or synchronize it to make
validation pass.

Preservation evidence includes refs, repository identity, manifest, modes,
configuration, status, and semantic index evidence.

git-index-semantic-v1 is normative: exact path/mode/object/stage mapping,
stage zero, ordinary flags, HEAD-tree equality and empty staged diff at
admission, with clean status.

Raw .git/index hashes are diagnostic only. A raw mismatch is not by itself
a staged-content change. Investigate and record discrepancies honestly.

Use the accepted sanitized Git inspection wrapper, optional locks disabled,
NUL-safe paths, and built-in Node SHA-256. Do not use git write-tree for
read-only target inspection or download hashing tools.

The post-integration preserved-checkout condition below is an explicit
exception to admission's clean/index-equals-HEAD condition.

## Offline validation and isolation

Inspect scripts before running them. For implementation verification, use
the complete approved scripts/test-offline.sh wrapper under OS-enforced
network denial. Do not substitute an unsandboxed run.

Use disposable repositories for mutation tests. Never use the protected
target as a mutation fixture. Add no dependencies or downloads without
separate approved scope.

Real role sessions and descendants require verified OS confinement:

* Network access denied.
* Authority-store reads and writes denied.
* Controller and authoritative-target writes denied.
* Required designated role workspace/output access available.

A file mode, prompt instruction, or successful disposable probe alone does
not establish confinement for a real session. Verify actual paths and
launch conditions. The controller does not launch or confine roles itself.

## Real-pilot authority

Creating this policy or publishing a controller release does not activate
the pilot.

Real execution requires:

* Independent review and Architect acceptance of the executing release.
* Publication of that exact release.
* Separate explicit human-controlled authority provisioning.
* Verified real role confinement.
* Explicit human approval and exactly one digest-confirmed authorization.

Trusted authority root:
/Users/yuriy/Library/Application Support/AI Agent Radar Orchestrator/authority/

The human operator runs trusted authority commands outside role sandboxes.
The directory uses 0700 and the ledger 0600, together with OS confinement.
Modes alone do not isolate same-user roles.

Authority must come from the fixed trusted location and filesystem identity.
Payload paths, recomputed digests, role outputs, caller overrides, copied
ledgers, and disposable stores cannot substitute authority.

Do not hand-edit, duplicate, reset, or migrate the ledger to bypass lifecycle
checks. Preserve issued, claimed, closed, consumed, and reconciliation history.
Legacy raw-index-only authorization evidence is rejected, not converted.

Bind authorization to the exact executing published release, request,
target identity, baseline, scope, and required evidence. A later controller
commit requires review/publication and a correctly bound authorization;
do not reuse a grant for a different release.

## First-pilot scope and integration

The first pilot permits one regular non-executable ADD:
docs/learning/offline-fixture-reading.md

Maximum 800 words. Content must be fictional, offline, non-governance,
non-production, and non-operational. No credentials, secrets, provider,
deployment, or billing instructions.

Integration requires independent positive Analyst evidence, Architect ACCEPT,
valid authorization, no hold, and current matching workflow/target evidence.
The trusted operator invokes integration separately; roles do not perform it.

Real integration:

1. Persist intent and enter INTEGRATING before mutation.
2. Import and verify the exact reviewed local candidate.
3. Recheck authority, workflow evidence, and target conditions under locks.
4. Advance only refs/heads/self-improvement with expected-old protection.
5. Validate preserved-checkout evidence before consuming authorization.

No cherry-pick, force, reset, forced checkout, restore, clean, index replacement,
or worktree reconstruction on the real target. No remote target push.

Success records REF_ADVANCED_CHECKOUT_PRESERVED:

* Branch and symbolic HEAD resolve to the candidate.
* Index/worktree remain at their pre-integration baseline.
* For the single ADD, porcelain is:
  D  docs/learning/offline-fixture-reading.md
* The checkout is intentionally unsynchronized, not clean.
* Do not commit that discrepancy or automatically repair it.
* Later synchronization requires a separate explicit human-controlled action.

Any uncertainty after durable intent requires reconciliation. Preserve evidence;
do not automatically retry, roll back refs, reset checkout, replace authority,
or take over stale locks. Confirmed replay returns stored evidence without
another integration.

## Handoffs and summaries

Report cycle/revision, role, repository/branch, baseline and exact candidate,
changed paths, approved scope, validation commands and actual outcomes,
review/disposition, deviations, production impact, risks, and next human action.

For integration, include intent/outcome, authorization identity, candidate,
protected refs, pre/post checkout evidence, synchronization state, and holds.
Do not include secrets, credentials, private addresses, or authority payloads
unnecessary for review.

Keep notification records explicitly simulated. Do not send messages or email.

Do not claim an aggregate test total that the retained runner evidence cannot
support. Attribute Builder and Analyst observations separately until reconciled.

Governance changes require a separate bounded human-approved task and
independent review. This file cannot authorize its own expansion.
