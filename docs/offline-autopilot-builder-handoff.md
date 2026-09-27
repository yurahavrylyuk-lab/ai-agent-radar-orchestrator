# Offline autopilot Builder handoff

## Scope and baseline

This checkpoint implements the approved deterministic offline-autopilot design
on parent `ed465d2e6b04d26eaeb382f13b4795f252da9edf`. It does not publish, issue or
consume production authority, resume the historical pilot, or modify the
protected AI Agent Radar target.

The public command is `autopilot-offline`. It creates a private disposable
target, controller state, authorization binding, execution journal, role
workspaces, and final integration-preparation record beneath a caller-selected
`/private/tmp` directory. The only transport is `OfflineFixtureTransport`.

## Trust boundaries

Transport frames are canonical, length-prefixed, versioned, digest-bound, and
strictly sequenced. Fixture output is untrusted and passes existing role-result
validation before submission. The transport receives no authority handle,
host shell, unrestricted filesystem capability, provider, network, or
integration callback.

Builder operations run in an independent disposable Git repository. The child
process uses the reviewed macOS sandbox policy and returns native
`sandbox_check` evidence for itself and a descendant. The evidence must show
authority read/write, controller write, target write, inbound network, and
outbound network denied, while its designated workspace is writable. The child
accepts one strict `write_fixture` request for the approved path only.

The ordinary TAP suite still runs under the wrapper's OS-enforced inbound and
outbound network denial. macOS does not permit a second `sandbox-exec` profile
inside an already sandboxed process, so the wrapper creates real Builder
integration evidence in a separate pre-suite phase. Those Builder children are
themselves confined by the stricter filesystem-and-network profile, and the
sandboxed TAP tests inspect the retained evidence. No unsandboxed Builder
fallback exists.

## Evidence and lifecycle

Executed validation evidence binds the baseline and candidate commits, tree,
fixture blob SHA-256, recipe version, execution ID, checkpoint identity, actual
outcome, and details digest. Analyst `REVISE` is derived from a real failed
content recipe in revision scenario iteration one; the corrected iteration two
passes and reaches Architect `ACCEPT`.

Execution records follow `PREPARING`, `CONFINEMENT_VERIFIED`, `EXECUTING`,
`RESULT_CAPTURED`, `EXECUTION_FINISHED`, and `SUBMITTED`. Records may terminate
as `ABORTED` only before execution begins. Started Builder, captured-result,
durability-uncertain, orphan, or workspace uncertainty fails closed as
`RECONCILIATION_REQUIRED`. Controller-owned monotonic and persisted role timing
is retained; fixtures cannot supply timing.

## Verification and limitations

The mandatory wrapper runs the complete existing and expanded suite, public
CLI success/revision demonstrations, crash/restart cases, strict protocol
negative tests, validation evidence checks, and actual Builder/descendant
confinement checks. The final pre-checkpoint run reported 180 TAP tests passed,
zero failed, and 13 wrapper checks passed with zero failed. The local checkpoint
identity is reported by the Builder after commit creation.

This proof does not qualify a model transport and cannot launch Claude, Codex,
OpenAI, Anthropic, Gemini, or any other provider. It performs no real
integration. A human must inspect the preparation record; publication and any
future real-role transport remain separate governance decisions.
