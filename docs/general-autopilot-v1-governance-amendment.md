# Candidate Amendment: General Instruction Autopilot v1

**Status: proposed only; not effective.** This document is a bounded candidate
governance change based on controller commit
\`dcf2aa2c22876adfc49a356b6a0bcd25c73c3f10\`. It neither authorizes an
implementation nor alters the current offline-only runtime. It becomes
effective only after explicit Trusted Human approval, independent Analyst
review of its exact commit, and a separate Architect disposition accepting that
same reviewed commit.

## Purpose and scope

The current policy correctly forbids the requested capability: it permits
automatic role execution only for the deterministic, disposable
\`autopilot-offline\` transport; it forbids live providers and automatic role
launch; and it makes the AI Agent Radar checkout read-only outside separately
authorized integration. This amendment authorizes one additional, additive
controller-maintenance capability: **General Instruction Autopilot v1**.

Each cycle starts only from one explicit natural-language instruction supplied
by the Trusted Human Operator. For the one fixed target repository
\`/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent\`,
the controller may automatically run a model-backed Architect, Builder
reasoning, Analyst, and final Architect disposition. It may relay controller
owned plans, candidate evidence, validation results, and Analyst \`REVISE\`
findings without human copy/paste. It may perform no more than three
Builder/Analyst iterations and must stop at \`READY_FOR_INTEGRATION\` on an
accepted candidate.

This is not real-pilot activation, authorization issuance, trusted
integration, or production authority. All existing real-pilot requirements
remain unchanged.

## The only effective-policy edit proposed after approval

After the review sequence above, amend **only \`AGENTS.md\`**. The existing
activation-gate plan, operator guide, Builder handoffs, and README describe
the current implementation and must not be rewritten by this amendment. The
implementation task will update runtime documentation only if its accepted
behavior differs from those descriptions.

### Replace the offline-only exception paragraph

Replace the paragraph beginning “The sole automatic-role exception” with:

> Automatic roles are forbidden except for two human-started, controller-managed
> capabilities. \`autopilot-offline\` remains limited to its deterministic
> \`OfflineFixtureTransport\`, disposable authority/state, and independent
> disposable Git repository below the system temporary root. It cannot consume
> production authority, target the AI Agent Radar repository, create a
> production integration intent, contact a provider, or authorize a real role.
>
> **General Instruction Autopilot v1** is the sole additional exception. One
> explicit natural-language instruction from the Trusted Human Operator may
> start one fresh, non-resumable cycle for the fixed AI Agent Radar repository
> at \`/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI
> Monitoring Agent\`. The controller may make model-backed Architect, Builder
> reasoning, Analyst, and final Architect calls, and may automatically relay
> only controller-owned task data and Analyst \`REVISE\` findings between them.
> It may create an isolated task workspace and an \`autopilot/<task-id>\` branch
> based on \`self-improvement\`, use the restricted local executor to make the
> approved candidate changes, create local candidate commits, and run approved
> local build, test, and typecheck commands. It must stop at
> \`READY_FOR_INTEGRATION\`; it has no authority to merge, push, deploy, alter
> production configuration or secrets, issue or consume authority, create an
> integration intent, or modify the protected checkout at its canonical path.

### Replace the automatic-role/provider prohibition bullets

In “Limits and prohibited capabilities”, replace the bullet beginning “No paid
fallback or model fallback” and the paragraph beginning “Do not introduce or
invoke live provider” with:

> * No paid fallback or model fallback. Automatic role launch is forbidden
>   except for \`OFFLINE_FIXTURE\` and the explicitly human-initiated General
>   Instruction Autopilot v1 capability above. General Autopilot may use exactly
>   one explicitly implemented model-provider transport for role reasoning;
>   malformed output, unavailable included capacity, or an unavailable
>   credential must fail the cycle closed. It may not fall back to fixtures or a
>   different model/provider.
>
> Outside General Instruction Autopilot v1, do not introduce or invoke live
> provider, email, deployment, scheduling, publication, credential, or billing
> adapters. Within that capability, the provider transport may use network only
> for the selected model-provider request. Credentials remain outside Git and
> must never enter prompts, logs, commits, candidate files, or role outputs.
> Builder commands remain separately network-denied. No automatic credit
> purchase, capacity purchase, paid/overage upgrade, autonomous billing, email,
> scheduling, publication, deployment, or production behavior change is
> authorized.

### Add the isolated-workspace exception to protected-target handling

Insert after the paragraph beginning “Outside the separately authorized
integration operation”:

> General Instruction Autopilot v1 may read the fixed target only to establish
> an isolated task workspace from \`self-improvement\`. The canonical protected
> checkout remains read-only. All candidate writes and commits must be confined
> to the registered isolated task workspace and its \`autopilot/<task-id>\`
> branch. The controller must reject arbitrary repository, workspace, branch,
> target-path, authority-store, controller-source, and production configuration
> writes. It must not reset, repair, clean, restore, synchronize, merge, or
> push either the protected checkout or a production branch.

### Add the model/local-executor boundary to offline validation and isolation

Insert after the first paragraph of “Offline validation and isolation”:

> For General Instruction Autopilot v1, model-provider networking belongs only
> to the explicit controller-owned model transport. The Builder model proposes
> structured changes and commands but receives no unrestricted shell or
> filesystem authority. The trusted restricted executor validates and performs
> allowed local operations only in the designated task workspace, under the
> existing authority-store, controller, protected-checkout, production, and
> local-network restrictions. The implementation must bound context to relevant
> repository metadata, plan, findings, diff/object evidence, and validation
> output; it must validate strict machine-readable role results before every
> controller transition. No recursive role spawning, background loop, crash
> resume, or reconciliation facility is authorized.

## Authorized boundary in compact form

| Area | Authorized for General Autopilot v1 | Still prohibited |
| --- | --- | --- |
| Initiation | One explicit human natural-language instruction per fresh cycle | Schedules, background work, recursive task creation, unattended starts |
| Roles | One provider's model-backed Architect, Builder reasoning, Analyst, and final Architect calls; automatic controller handoffs | Provider/model fallback, malformed-result recovery by guesswork, unrestricted model tools |
| Local changes | Restricted executor in an isolated \`autopilot/<task-id>\` workspace from \`self-improvement\`; local candidate commits | Protected-checkout writes, arbitrary paths/repos, orchestrator self-modification, authority-store writes |
| Network | Explicit controller model transport only | Builder-command network, provider access outside the transport, email, deployment, publishing |
| Git outcome | Candidate branch/workspace and \`READY_FOR_INTEGRATION\` only | Merge to \`self-improvement\` or \`main\`, remote push, integration intent, production deployment |
| Limits | Three Builder/Analyst iterations; existing 15-minute per-role and 90-minute cycle limits; bounded transport calls/context | Paid fallback, automatic credit/capacity purchase, billing changes, resume/reconciliation |

The implementation must retain deterministic offline scenarios as regression
tests and must not weaken their confinement, no-provider, no-target, or
non-integration properties.

## Required independent Analyst handoff

Review the exact candidate commit whose parent is
\`dcf2aa2c22876adfc49a356b6a0bcd25c73c3f10\`. Review only this amendment and
its diff. Confirm that it:

1. remains non-effective pending explicit Trusted Human approval;
2. authorizes only the stated human-initiated, fixed-target capability;
3. keeps the canonical protected checkout read-only and confines writes to an
   isolated task workspace and temporary branch;
4. permits model-provider networking only through one controller-owned
   transport while retaining Builder network denial and all authority-store
   restrictions;
5. preserves the three-iteration, no-fallback, no-spend, no-resume, and
   \`READY_FOR_INTEGRATION\` limits; and
6. does not authorize integration, merge, push, publication, deployment,
   scheduling, billing, credentials in Git, or production changes.

Record \`PASS\` or concrete \`REVISE\`/\`REJECT\` findings against the exact commit.
Do not alter the amendment, implementation, historical evidence, or target
repository.

## Required Architect handoff after Analyst review

Review the exact candidate commit, its parent, explicit Trusted Human approval,
and the independent Analyst record. Issue one of \`ACCEPT\`, \`ACCEPT WITH
RECOMMENDATIONS\`, \`REVISE\`, \`REJECT\`, or \`HUMAN REVIEW REQUIRED\`. An
acceptance may authorize a later, separately scoped General Instruction
Autopilot v1 implementation task only. It does not authorize publication,
real-pilot activation, authority provisioning, integration, merge, push,
deployment, or any AI Agent Radar production change.
