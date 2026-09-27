import fs from "node:fs";
import path from "node:path";
import { runOfflineAutopilot } from "../../src/autopilot.mjs";
import { acquireLock } from "../../src/local-store.mjs";

const root = fs.realpathSync(process.argv[2]);
const controllerRoot = fs.realpathSync(process.cwd());
const fixedNow = "2026-09-27T12:00:00.000Z";

function run(name, scenario, options = {}) {
  const runtimeRoot = path.join(root, name);
  const result = runOfflineAutopilot({ runtimeRoot, scenario, controllerRoot, now: fixedNow, ...options });
  fs.writeFileSync(path.join(runtimeRoot, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

function expectedFailure(action, pattern) {
  try { action(); } catch (error) {
    if (!pattern.test(error.message)) throw error;
    return error.message;
  }
  throw new Error(`EXPECTED_FAILURE_MISSING:${pattern}`);
}

const success = run("success", "success");
const revision = run("revision", "revision");

const crashBeforeRoot = path.join(root, "crash-before");
const crashBefore = expectedFailure(() => run("crash-before", "success", { inject: { afterRoles: 0, phase: "before-execution" } }), /INJECTED_CRASH_BEFORE_EXECUTION/u);
const crashBeforeRecovery = runOfflineAutopilot({ runtimeRoot: crashBeforeRoot, scenario: "success", controllerRoot, now: fixedNow });

const crashBetweenRoot = path.join(root, "crash-between");
const crashBetween = expectedFailure(() => run("crash-between", "success", { inject: { betweenRoles: 1 } }), /INJECTED_CRASH_BETWEEN_ROLES/u);
const crashBetweenRecovery = runOfflineAutopilot({ runtimeRoot: crashBetweenRoot, scenario: "success", controllerRoot, now: fixedNow });

const crashDuringRoot = path.join(root, "crash-during-builder");
const crashDuring = expectedFailure(() => run("crash-during-builder", "success", { inject: { afterRoles: 1, phase: "during-builder" } }), /INJECTED_CRASH_DURING_BUILDER/u);
const crashDuringRecovery = expectedFailure(() => runOfflineAutopilot({ runtimeRoot: crashDuringRoot, scenario: "success", controllerRoot, now: fixedNow }), /RECONCILIATION_REQUIRED/u);

const crashAfterCaptureRoot = path.join(root, "crash-after-capture");
const crashAfterCapture = expectedFailure(() => run("crash-after-capture", "success", { inject: { afterRoles: 0, phase: "after-capture" } }), /INJECTED_CRASH_AFTER_CAPTURE/u);
const crashAfterCaptureRecovery = expectedFailure(() => runOfflineAutopilot({ runtimeRoot: crashAfterCaptureRoot, scenario: "success", controllerRoot, now: fixedNow }), /RECONCILIATION_REQUIRED/u);

const uncertainRoot = path.join(root, "uncertain-submission");
const uncertainSubmission = expectedFailure(() => run("uncertain-submission", "success", { inject: { afterRoles: 0, phase: "uncertain-submission" } }), /PERSISTENCE_DURABILITY_UNCERTAIN/u);
const uncertainRecovery = expectedFailure(() => runOfflineAutopilot({ runtimeRoot: uncertainRoot, scenario: "success", controllerRoot, now: fixedNow }), /RECONCILIATION_REQUIRED/u);

const duplicateRoot = path.join(root, "duplicate-runner");
fs.mkdirSync(duplicateRoot, { recursive: true, mode: 0o700 });
const held = acquireLock(path.join(duplicateRoot, "offline-runner.lock"), { controllerId: "offline-autopilot", generation: 1, pid: process.pid });
if (!held.acquired) throw new Error("DUPLICATE_TEST_LOCK_UNAVAILABLE");
const duplicateRunner = expectedFailure(() => runOfflineAutopilot({ runtimeRoot: duplicateRoot, scenario: "success", controllerRoot, now: fixedNow }), /OFFLINE_AUTOPILOT_ALREADY_RUNNING/u);
held.release();

const uncertaintyRoot = path.join(root, "integration-preparation-uncertainty");
run("integration-preparation-uncertainty", "success");
const preparationPath = path.join(uncertaintyRoot, "integration-preparation.json");
const preparation = JSON.parse(fs.readFileSync(preparationPath, "utf8"));
fs.writeFileSync(preparationPath, `${JSON.stringify({ ...preparation, candidateCommit: "0".repeat(40) }, null, 2)}\n`);
const integrationPreparationUncertainty = expectedFailure(() => runOfflineAutopilot({ runtimeRoot: uncertaintyRoot, scenario: "success", controllerRoot, now: fixedNow }), /INTEGRATION_PREPARATION_UNCERTAIN/u);

const evidence = {
  schemaVersion: 1,
  roots: { success: path.join(root, "success"), revision: path.join(root, "revision"), crashBefore: crashBeforeRoot, crashBetween: crashBetweenRoot, crashDuring: crashDuringRoot, crashAfterCapture: crashAfterCaptureRoot, uncertain: uncertainRoot },
  outcomes: {
    success: success.status,
    revision: revision.status,
    crashBefore,
    crashBeforeRecovery: crashBeforeRecovery.status,
    crashBetween,
    crashBetweenRecovery: crashBetweenRecovery.status,
    crashDuring,
    crashDuringRecovery,
    crashAfterCapture,
    crashAfterCaptureRecovery,
    uncertainSubmission,
    uncertainRecovery,
    duplicateRunner,
    integrationPreparationUncertainty,
  },
};
fs.writeFileSync(path.join(root, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${path.join(root, "evidence.json")}\n`);
