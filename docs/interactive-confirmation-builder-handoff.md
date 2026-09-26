# GOV-002 interactive confirmation — Builder revision 1

## Scope and root cause

This bounded controller-maintenance change starts from published release `1d82083d5840d5cdb63636d01881cf5840c55a42`. The prior `authorize-pilot` command used `fs.readFileSync(0, "utf8").trim()`: a synchronous whole-stream read that produced `EAGAIN` in interactive PTYs and also normalized input contrary to exact digest confirmation. No real authorization, pilot, integration, target mutation, or publication is part of this correction.

The CLI now delegates confirmation to `src/interactive-confirmation.mjs`, implemented only with Node built-ins. The helper requires TTY stdin, completes proposal and prompt output before accepting input, then reads exactly one newline-terminated line through `node:readline`. It compares that line directly with `CONFIRM ${authorizationDigest}` without trimming, case conversion, whitespace normalization, substring matching, or a reprompt. Pressing Enter completes input; EOF is not required.

The in-memory flow is `VALIDATING → PROPOSAL_READY → DISPLAYING → WAITING_FOR_ONE_LINE → EXACT_MATCH → ISSUING → ISSUED`. Invalid input, early input, EOF, unterminated input, stream errors including `EAGAIN`, output failure, `SIGINT`, `SIGTERM`, or `SIGHUP` transitions to `ABORTED` before persistence. Reader and signal listeners are removed on settlement, and one invocation can resolve only once. Existing proposal preparation and authority persistence ordering remain unchanged, so no ledger exists while the prompt waits.

## Disposable verification evidence

The targeted OS-network-denied run passed 15 of 15 Node tests. Coverage includes correct current digest, wrong and stale digests, blank/generic/malformed/padded/extra input, EOF and unterminated input, injected `EAGAIN`, generic stream failure, three interruption signals, pipe/file refusal, early input, display failure, duplicate input, listener cleanup, replay refusal, no-ledger waiting, one issuance, and PTY EOF/interruption behavior.

The automated disposable PTY regression displayed the complete proposal and prompt, observed that the disposable ledger did not exist while waiting, sent the exact current fixture digest followed by Enter, created exactly one `ISSUED` record, exited cleanly, and rejected replay without a second grant. Disposable PTY EOF and interruption each exited unsuccessfully without creating a ledger.

The human-operated disposable PTY displayed digest `8434522b9416f8373e948f77298065507c233935d4e2890111c30c8097eab7f8`. The human supplied the exact `CONFIRM` line; Enter completed input without EOF, the helper returned `DISPOSABLE_CONFIRMATION_ACCEPTED`, and the process exited `0`. This helper creates no authority state.

The complete required `/bin/sh scripts/test-offline.sh` path ran under the existing filesystem and network-denial policy. Retained runtime evidence reported `OFFLINE_RUNNER_AGGREGATE tests=168 pass=168 fail=0` and the distinct shell layer reported `OFFLINE_WRAPPER_CHECKS pass=12 fail=0`. No total is hardcoded in the wrapper.

## Preservation and handoff

The first-pilot request and approval remain byte-for-byte unchanged, the real authority directory remains empty, and previously displayed unissued digests remain stale. The protected target remains read-only on the approved `self-improvement` baseline with its manifest, modes, configuration, semantic index, and absent pilot path preserved. Production dependencies, schemas, digest generation, authority identity, persistence, confinement, snapshots, integration, and the offline wrapper are unchanged.

The checkpoint from this handoff is local only. It requires independent Analyst review and Architect disposition before any separate publication decision. It does not authorize retrying the real first-pilot authorization.
