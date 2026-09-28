import fs from "node:fs";
import path from "node:path";
import { runOfflineAutopilotForTest } from "../../src/autopilot.mjs";
import { createOfflineExecutionTestControl } from "../../src/role-execution.mjs";

const root = fs.realpathSync(process.argv[2]); const controllerRoot = fs.realpathSync(process.cwd());
function execute(name, scenario, options = {}) { const runtimeRoot = path.join(root, name); const result = runOfflineAutopilotForTest({ runtimeRoot, scenario, controllerRoot, allowedRuntimeParent: root, ...options }); fs.writeFileSync(path.join(runtimeRoot, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 }); return result; }
function expectedFailure(action, pattern) { try { action(); } catch (error) { if (!pattern.test(error.message)) throw error; return error.message; } throw new Error(`EXPECTED_FAILURE_MISSING:${pattern}`); }

const success = execute("success", "success"); const revision = execute("revision", "revision");
const timed = execute("timed", "success", { executionControl: createOfflineExecutionTestControl({ advances: { "after-transport": [25, 25, 25, 25, 25] } }) });
const timeoutRoot = path.join(root, "timeout"); const timeout = expectedFailure(() => execute("timeout", "success", { executionControl: createOfflineExecutionTestControl({ roleLimitMs: 100, builderDelayMs: 500 }) }), /OFFLINE_ROLE_DEADLINE_EXCEEDED/u);
const maximumRoot = path.join(root, "maximum-iterations"); const maximumIterations = expectedFailure(() => execute("maximum-iterations", "success", { transportOverrides: { builderContents: ["# Fictional Offline Fixture\n\nInvalid round one.\n", "# Fictional Offline Fixture\n\nInvalid round two.\n", "# Fictional Offline Fixture\n\nInvalid round three.\n"] } }), /OFFLINE_AUTOPILOT_NO_PENDING_TASK/u);
const failedRoot = path.join(root, "failed"); const failed = expectedFailure(() => execute("failed", "success", { transportOverrides: { transportFailure: "ARCHITECT_PLAN" } }), /OFFLINE_TRANSPORT_FAILURE/u);
const failedRestart = expectedFailure(() => runOfflineAutopilotForTest({ runtimeRoot: failedRoot, scenario: "success", controllerRoot, allowedRuntimeParent: root }), /OFFLINE_AUTOPILOT_RUNTIME_LEAF_EXISTS/u);

const evidence = { schemaVersion: 2, roots: { success: path.join(root, "success"), revision: path.join(root, "revision"), timed: path.join(root, "timed"), timeout: timeoutRoot, maximumIterations: maximumRoot, failed: failedRoot }, outcomes: { success: success.status, revision: revision.status, timed: timed.status, timeout, maximumIterations, failed, failedRestart } };
const evidencePath = path.join(root, "evidence.json"); fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 }); process.stdout.write(`${evidencePath}\n`);
