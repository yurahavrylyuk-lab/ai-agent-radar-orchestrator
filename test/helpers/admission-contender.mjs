import { admitNextCycle } from "../../src/local-store.mjs";

const [statePath, lockPath, cycleId, requestId, now] = process.argv.slice(2);
const result = admitNextCycle({
  statePath,
  lockPath,
  claim: { ownerId: "owner", generation: 1, stateVersion: 0 },
  cycle: { id: cycleId, requestId, status: "ACTIVE", planRevision: 4, baseline: "baseline", iterationIds: [], activeMs: 0, humanWaitingMs: 0, liveOperationsEnabled: false },
  now,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
