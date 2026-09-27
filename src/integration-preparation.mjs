import fs from "node:fs";
import path from "node:path";
import { sha256Canonical } from "./contracts.mjs";
import { replaceStateAtomic } from "./local-store.mjs";

function validatePreparation(value) {
  const fields = ["schemaVersion", "status", "evidenceMode", "runId", "cycleId", "candidateCommit", "controllerCommit", "controllerTree", "executionReceiptDigests", "productionIntegrationIntentCreated", "targetMutationPerformed", "createdAt", "preparationDigest"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== fields.sort().join("\0")) throw new Error("INTEGRATION_PREPARATION_INVALID");
  const { preparationDigest, ...unsigned } = value;
  if (value.schemaVersion !== 1 || value.status !== "INTEGRATION_PREPARATION" || value.evidenceMode !== "OFFLINE_FIXTURE" || value.productionIntegrationIntentCreated !== false || value.targetMutationPerformed !== false || !/^[0-9a-f]{40}$/u.test(value.candidateCommit) || !/^[0-9a-f]{40}$/u.test(value.controllerCommit) || !/^[0-9a-f]{40}$/u.test(value.controllerTree) || !Array.isArray(value.executionReceiptDigests) || !value.executionReceiptDigests.every((item) => /^[0-9a-f]{64}$/u.test(item)) || sha256Canonical(unsigned) !== preparationDigest) throw new Error("INTEGRATION_PREPARATION_INVALID");
  return true;
}

export function createIntegrationPreparation({ filePath, runId, cycle, executionReceipts, controller, now }) {
  if (cycle.status !== "REVIEW" || cycle.stage !== "AWAITING_INTEGRATION" || cycle.architectDecision !== "ACCEPT" || !cycle.candidateCommit) throw new Error("OFFLINE_INTEGRATION_PREPARATION_NOT_ELIGIBLE");
  if (fs.existsSync(filePath)) {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
    try { validatePreparation(existing); } catch { throw new Error("INTEGRATION_PREPARATION_UNCERTAIN"); }
    if (existing.runId !== runId || existing.cycleId !== cycle.id || existing.candidateCommit !== cycle.candidateCommit) throw new Error("INTEGRATION_PREPARATION_UNCERTAIN");
    return existing;
  }
  const unsigned = { schemaVersion: 1, status: "INTEGRATION_PREPARATION", evidenceMode: "OFFLINE_FIXTURE", runId, cycleId: cycle.id, candidateCommit: cycle.candidateCommit, controllerCommit: controller.commit, controllerTree: controller.tree, executionReceiptDigests: executionReceipts.map((item) => item.receiptDigest), productionIntegrationIntentCreated: false, targetMutationPerformed: false, createdAt: now };
  const record = { ...unsigned, preparationDigest: sha256Canonical(unsigned) };
  validatePreparation(record);
  fs.mkdirSync(path.dirname(filePath), { recursive: true }); replaceStateAtomic(filePath, record); return record;
}
