#!/usr/local/bin/node
import fs from "node:fs";
import path from "node:path";
import { parseJsonStrict } from "./contracts.mjs";
import { controllerStatus, enqueueRequest, initializeController, isRealTarget, newestSummary, preparePendingWorkspace, runRehearsal } from "./coordinator.mjs";
import { createLocalCheckpoint } from "./local-checkpoint.mjs";
import { integrateFixtureCandidate } from "./local-integration.mjs";
import { readState } from "./local-store.mjs";
import { commitPilotAuthorization, preparePilotAuthorization, showPilotAuthorization } from "./pilot-authorization.mjs";
import { admitRealPilotRequest } from "./real-pilot-admission.mjs";
import { integrateRealCandidate } from "./real-local-integration.mjs";
import { finishRole, startRole } from "./role-timing.mjs";
import { submitRoleResult } from "./result-submission.mjs";
import { migrateStateV1ToV2 } from "./state-migration.mjs";
import { renderTaskPrompt } from "./task-renderer.mjs";

function option(args, name, fallback = null) { const index = args.indexOf(name); if (index === -1) return fallback; if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`MISSING_OPTION_VALUE:${name}`); return args[index + 1]; }
function readJson(file) { return parseJsonStrict(fs.readFileSync(file, "utf8")); }
function print(value) { process.stdout.write(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`); }

async function main(argv) {
  const command = argv[0]; const statePath = path.resolve(option(argv, "--state", ".runtime/controller/state.json"));
  const now = option(argv, "--now", new Date().toISOString());
  if (command === "rehearse") { const root = path.resolve(option(argv, "--runtime", `.runtime/rehearsal-${Date.now()}`)); print(await runRehearsal(root)); return; }
  if (command === "authorize-pilot") {
    if (argv.includes("--now") || argv.includes("--yes")) throw new Error("AUTOMATIC_OR_TIME_OVERRIDE_FORBIDDEN");
    const file = option(argv, "--file"); const approvalFile = option(argv, "--approval-file"); if (!file || !approvalFile) throw new Error("REQUEST_AND_APPROVAL_FILE_REQUIRED");
    const request = readJson(file); const humanApproval = readJson(approvalFile); const proposal = preparePilotAuthorization({ statePath, request, humanApproval, controllerRoot: process.cwd() });
    process.stderr.write(`${JSON.stringify({ proposedAuthorization: proposal.grant, authorizationDigest: proposal.grant.authorizationDigest }, null, 2)}\n`);
    process.stderr.write(`Type CONFIRM ${proposal.grant.authorizationDigest} to issue this single-use authorization:\n`);
    if (isRealTarget(request.targetRoot) && !process.stdin.isTTY) throw new Error("INTERACTIVE_TTY_CONFIRMATION_REQUIRED");
    const confirmation = fs.readFileSync(0, "utf8").trim(); print(commitPilotAuthorization({ statePath, proposal, confirmation })); return;
  }
  if (command === "show-authorization") { const id = option(argv, "--authorization"); if (!id) throw new Error("AUTHORIZATION_ID_REQUIRED"); print(showPilotAuthorization(statePath, id)); return; }
  if (command === "integrate-local") { if (["--now", "--target", "--candidate", "--branch", "--commit"].some((flag) => argv.includes(flag))) throw new Error("REAL_INTEGRATION_OVERRIDE_FORBIDDEN"); const cycleId = option(argv, "--cycle"); if (!cycleId) throw new Error("CYCLE_ID_REQUIRED"); print(integrateRealCandidate({ statePath, cycleId, controllerRoot: process.cwd() })); return; }
  if (command === "init") { const file = option(argv, "--file"); if (!file) throw new Error("INIT_FILE_REQUIRED"); const config = readJson(file); print(initializeController(statePath, config)); return; }
  if (command === "migrate-state") { const file = option(argv, "--file"); if (!file) throw new Error("MIGRATION_FILE_REQUIRED"); const config = readJson(file); print(migrateStateV1ToV2({ statePath, evidenceRoot: path.resolve(config.evidenceRoot), repositoryId: config.repositoryId, evidenceMode: config.evidenceMode, approval: config.approval, now: config.now })); return; }
  const state = readState(statePath); const ownerId = state.owner.id; const ownerGeneration = state.owner.generation;
  if (state.schemaVersion === 3 && argv.includes("--now")) throw new Error("REAL_TIME_OVERRIDE_FORBIDDEN");
  if (command === "status") { print(controllerStatus(statePath)); return; }
  if (command === "show-summary") { print(newestSummary(statePath)); return; }
  if (command === "next-task") { if (state.pendingTaskId === null) { print({ status: "NO_PENDING_TASK" }); return; } const task = state.tasks.find((item) => item.taskId === state.pendingTaskId); print(renderTaskPrompt(task, state)); return; }
  if (command === "enqueue") { const file = option(argv, "--file"); if (!file) throw new Error("REQUEST_FILE_REQUIRED"); const request = readJson(file); print(state.schemaVersion === 3 ? admitRealPilotRequest({ statePath, request, controllerRoot: process.cwd() }) : enqueueRequest({ statePath, ownerId, ownerGeneration, request }).value); return; }
  if (command === "prepare-workspace") { const taskId = option(argv, "--task"); if (!taskId) throw new Error("TASK_ID_REQUIRED"); const runtimeRoot = path.resolve(option(argv, "--runtime", path.join(path.dirname(statePath), "workspace-runtime"))); print(preparePendingWorkspace({ statePath, ownerId, ownerGeneration, taskId, runtimeRoot, now })); return; }
  if (command === "submit-result") { const file = option(argv, "--file"); if (!file) throw new Error("RESULT_FILE_REQUIRED"); print(submitRoleResult({ statePath, ownerId, ownerGeneration, result: readJson(file), now }).value); return; }
  if (command === "start-role") { const taskId = option(argv, "--task"); if (!taskId) throw new Error("TASK_ID_REQUIRED"); print(startRole({ statePath, ownerId, ownerGeneration, taskId, now }).value); return; }
  if (command === "finish-role") { const taskId = option(argv, "--task"); if (!taskId) throw new Error("TASK_ID_REQUIRED"); print(finishRole({ statePath, ownerId, ownerGeneration, taskId, now }).value); return; }
  if (command === "checkpoint") { const taskId = option(argv, "--task"); if (!taskId) throw new Error("TASK_ID_REQUIRED"); print(createLocalCheckpoint({ statePath, ownerId, ownerGeneration, taskId, now })); return; }
  if (command === "integrate-fixture") { const cycleId = option(argv, "--cycle"); const targetRoot = option(argv, "--target"); if (!cycleId || !targetRoot) throw new Error("CYCLE_AND_TARGET_REQUIRED"); print(integrateFixtureCandidate({ statePath, ownerId, ownerGeneration, cycleId, targetRoot: path.resolve(targetRoot), now, fixture: true })); return; }
  throw new Error("UNKNOWN_COMMAND");
}

main(process.argv.slice(2)).catch((error) => {
  const safe = { error: error.code ?? error.message, message: error.message };
  process.stderr.write(`${JSON.stringify(safe)}\n`);
  process.exitCode = /(?:HOLD|RECONCILIATION|UNCERTAIN)/u.test(safe.error) ? 3 : ["REAL_PILOT_NOT_AUTHORIZED", "UNKNOWN_COMMAND"].includes(safe.error) || /(?:INVALID|REQUIRED|WRONG|UNKNOWN|MISMATCH|CONFLICT|VIOLATION)/u.test(safe.error) ? 2 : 1;
});
