# GOV-002 Phase 2 Revision 3 Builder Handoff

## Status and History

Builder/Analyst implementation iteration 3 is ready for independent Analyst review. It is not self-certified complete, not Architect-accepted, and not authorized for real-pilot activation.

- Phase 2 revision 1 Builder: `c91e9ce37d52d676ead277dcb2492fd47aad4d77`; Analyst `PASS`; Architect `REVISE`.
- Phase 2 revision 2 Builder: `02632a283f50847a81bce3c3466bf73c9f2ce4e2`; Analyst `PASS`; Architect `REVISE`.
- The revision-2 Architect confirmed findings 1, 2, 4, 5, and 6 closed. Revision 3 changes only the remaining validation-evidence semantics, regression coverage, rehearsal, and documentation.

## Corrected Evidence Model

Controller-verified checkpoint identity and recipe outcome evidence are separate records.

`CHECKPOINT_IDENTITY` with `CONTROLLER_VERIFIED` provenance binds repository, evidence mode, cycle, task, role, candidate commit, checkpoint receipt/digest, tree, and scope. It proves candidate identity only and has no recipe ID or outcome.

`ROLE_VALIDATION_ATTESTATION` with `HUMAN_ATTESTED` provenance binds repository, evidence mode, cycle, task, role, recipe ID, candidate/reviewed commit, explicit `PASS` or `FAIL`, and the checkpoint-identity digest. The full record is retained inside the accepted role result, and `evidenceDigest` must equal its canonical SHA-256 digest.

The controller presents both outcome-specific attestation options but leaves the result template unperformed with null outcome/evidence fields. The role must actually perform the recipe and select the matching option. Checkpoint presence never synthesizes `PASS`. Missing, skipped, structurally changed, wrong-context, or digest-invalid evidence is rejected.

Builder completion and positive Analyst states require all mandatory outcomes to be `PASS`. Negative Analyst states may retain `FAIL`, allowing the review, evidence, one iteration summary, and next policy task to commit atomically. Architect `ACCEPT` and fixture integration revalidate the successful Analyst evidence.

## Verification

- Mandatory invocation: `/bin/sh scripts/test-offline.sh`.
- Native policy: `(version 1) (allow default) (deny network*)`.
- Network gate: `network-outbound: 1`, `network-inbound: 1`.
- Complete suite: 93 passed; 0 failed, skipped, cancelled, or todo.
- Unperformed regression: an existing checkpoint yields `AWAITING_ATTESTATION`; the response template remains null; checkpoint identity submitted as recipe `PASS` is rejected without changing persisted bytes.
- Binding regressions: candidate, task, repository, recipe, evidence mode, outcome, record, and digest mismatches fail closed.
- Negative-review regression: genuine `FAIL` evidence with Analyst `REVISE` is retained, exactly one iteration summary is created, and the next pending task is `ARCHITECT_REVISION`.
- Positive-review regression: Analyst `PASS` with genuine `FAIL` evidence is rejected without persistence; a complete human-attested `PASS` set succeeds.
- Public CLI regression: the supported CLI alone completes the failure/correction lifecycle without internal coordinator imports or manual state editing.

## Deterministic Rehearsal

- Cycle: `cycle:rehearsal-request`.
- Baseline: `d070ab9fe6c812ad1b32907de00e002d64549635`.
- Candidate 1: `4811991ad8a937a11afc6d7cc92b55e053bb47ed`.
- Candidate 1 review: `REVISE`, with retained `FAIL` evidence digest `5a16c40f0807b8971d7e79b41287d4207f10a079e879d5fec19635d975822cb0`.
- Iteration summary 1: `summary:cycle:rehearsal-request:iteration:1`, digest `e7f9ad0619d8a73e6c9d287ff1d471cb14ffc81eb5fb664635e1cbb0dc26cb46`.
- Candidate 2: `290d768dc2166bd19edac07b2b19b2a3cbf9f060`.
- Candidate 2 review: `PASS`, with retained `PASS` evidence digest `4ca46a671a030f8a087ddc5d1e4d82848bd5e9e7cc291e5b872475556294e066`.
- Iteration summary 2: `summary:cycle:rehearsal-request:iteration:2`, digest `69b40f39152f07014b89f678012baad9fd8aed00b4a0518d0d1766a5b1dce041`.
- Final summary: `summary:cycle:rehearsal-request:final`, digest `344c4428c1c50d29209184e59fd62c80e6ffb07369d703d79ce7ab922cdacdf2`.
- Integrated disposable fixture commit: `290d768dc2166bd19edac07b2b19b2a3cbf9f060`.

The rehearsal ran under native network denial. It made no provider call and touched no authoritative target.

## Protected Target and Capability Boundary

Before editing, the protected target matched the retained 75-file manifest `8b64f934c5bef4a8dc43e406f9cfbbba243e43497e3b91990f762c2366b52629`, remained clean on `self-improvement` at `33a60a1f74960f9c171f5449627db1be362c6481`, and retained `main`/`origin/main` at `3a6946fe07ea3838488c789cba4c69718b2ed328`. The future pilot file remained absent. The same comparison is required after the local checkpoint.

No dependency, provider, paid AI, email, Cloudflare, D1, scheduler, deployment, publication, credential handling, remote, or automatic Codex-launch capability is introduced. Fixture evidence is simulated and cannot authorize the real pilot.

## Remaining Limitation

Human-attested evidence records that the role's explicit outcome; it does not independently prove the underlying human activity. The independent Analyst must review the exact revision-3 commit, followed by Architect disposition. The exact commit is returned separately after final verification.
