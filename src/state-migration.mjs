import fs from "node:fs";
import path from "node:path";
import { parseJsonStrict, sha256Bytes } from "./contracts.mjs";
import { acquireLock, replaceStateAtomic } from "./local-store.mjs";
import { validateAuthorization, validateMachineState, validateMachineStateV2 } from "./validate.mjs";

export function migrateStateV1ToV2({ statePath, evidenceRoot, repositoryId, evidenceMode = "SIMULATED", approval, now, persistenceOptions = {} }) {
  validateAuthorization(approval); const lock = acquireLock(`${statePath}.lock`, { operation: "migration", pid: process.pid }); if (!lock.acquired) throw new Error(lock.reason);
  try {
    const bytes = fs.readFileSync(statePath); const sourceDigest = sha256Bytes(bytes); const source = parseJsonStrict(bytes.toString("utf8"));
    if (source.schemaVersion !== 1) throw new Error(source.schemaVersion === 2 ? "STATE_ALREADY_VERSION_2" : "UNKNOWN_STATE_SCHEMA_VERSION"); validateMachineState(source);
    if (source.activeCycleId !== null || source.humanHold || source.cycles.some((cycle) => !["ACCEPTED", "REJECTED", "ESCALATED", "HALTED"].includes(cycle.status))) throw new Error("ACTIVE_OR_HELD_LEGACY_STATE_REQUIRES_HUMAN_REVIEW");
    fs.mkdirSync(evidenceRoot, { recursive: true }); const evidencePath = path.join(evidenceRoot, `state-v1-${sourceDigest}.json`);
    let fd = null; try { fd = fs.openSync(evidencePath, "wx", 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } catch (error) { if (error.code !== "EEXIST") throw error; if (!fs.readFileSync(evidencePath).equals(bytes)) throw new Error("MIGRATION_EVIDENCE_CONFLICT"); } finally { if (fd !== null) fs.closeSync(fd); }
    const candidate = {
      schemaVersion: 2, controllerId: source.controllerId, repositoryId, evidenceMode, stateVersion: source.stateVersion + 1, owner: structuredClone(source.owner), queue: structuredClone(source.queue), activeCycleId: null, humanHold: false, approval: structuredClone(approval), capabilities: { realPilotActivation: false, liveProviders: false, network: false, publication: false, scheduling: false },
      cycles: structuredClone(source.cycles), plans: [], tasks: [], pendingTaskId: null, results: [], receipts: [], iterations: [], reviews: [], summaries: [], outbox: [], workspaces: [], timings: [], checkpointIntents: [], checkpointReceipts: [], integrationIntents: [], integrationOutcomes: [], migration: { sourceSchemaVersion: 1, sourceDigest, sourceEvidencePath: evidencePath, migratedAt: now },
    };
    validateMachineStateV2(candidate); replaceStateAtomic(statePath, candidate, persistenceOptions); return { sourceDigest, evidencePath, state: candidate };
  } finally { lock.release(); }
}
