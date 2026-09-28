# `ai-radar-search10` deterministic scenario

This bounded `OFFLINE_FIXTURE` scenario extends Simple Offline Autopilot V1 for one disposable real-code experiment. It accepts only a clean, canonical, independently cloned `self-improvement-search10-test` repository below an approved system temporary root at baseline `33a60a1f74960f9c171f5449627db1be362c6481`.

The Builder can request only `apply_ai_radar_search10`. That fixed operation verifies baseline-specific SHA-256 preconditions and then writes reviewed post-images for exactly:

- `src/services/monitor.ts`
- `src/tools/webSearch.ts`
- `test/monitor.test.ts`
- `test/webSearch.test.ts`

No patch text, path, shell command, query list, or coding-agent instruction comes from runtime input. A mismatch fails closed. Candidate validation reads the exact commit tree and all four blob objects, requires the fixed modes and object digests, and verifies the cumulative diff contains no other path.

The fixed repository checks are `npm run build`, `npm test`, and `tsc -p tsconfig.worker.json` using already-installed local dependencies. Each check is launched directly under the reviewed macOS policy that denies inbound and outbound networking while allowing only local Unix-socket IPC needed by `tsx`:

```text
(version 1) (allow default) (deny network*) (allow network* (local unix-socket))
```

The scenario checks that this policy reports both `network-outbound` and `network-inbound` denied. The Builder remains separately confined by the existing reviewed executor profile; wrapping the whole CLI in another `sandbox-exec` is neither required nor supported by macOS. The scenario does not install dependencies, invoke providers, create an integration intent, publish, deploy, schedule, resume, or mutate the protected AI Radar checkout. It stops at `READY_FOR_INTEGRATION`.

Operator entry point:

```text
node src/cli.mjs autopilot-offline --scenario ai-radar-search10 --runtime <fresh-runtime> --source <fresh-disposable-clone> --controller-commit <reviewed-controller-commit>
```

The source clone must have its remote removed before admission. The protected checkout and the historical claimed pilot are not scenario inputs and remain unchanged.
