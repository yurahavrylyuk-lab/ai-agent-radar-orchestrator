import { sha256Canonical } from "../contracts.mjs";
import { createExecutionFrame } from "../role-execution-protocol.mjs";
import { resultContextForTask } from "../validate.mjs";

export const OFFLINE_FIXTURE_ADAPTER_VERSION = "offline-fixture-r1";
export const OFFLINE_FIXTURE_SCENARIOS = Object.freeze(["success", "revision"]);
export const OFFLINE_FIXTURE_DIGEST = sha256Canonical({ version: OFFLINE_FIXTURE_ADAPTER_VERSION, scenarios: OFFLINE_FIXTURE_SCENARIOS });

const GOOD_CONTENT = `# Reading a Fictional Offline Fixture\n\nThis fictional, offline lesson explains how to inspect a small sample record without contacting any service. Read the title, identify the fields, compare the expected and observed values, and write down what the evidence supports.\n\nThe exercise is educational: it teaches careful observation, explicit assumptions, and repeatable local checks. The example does not describe a real system or an operational procedure.\n`;
const DEFECT_CONTENT = `# Reading a Fictional Offline Fixture\n\nThis fictional, offline example is intentionally incomplete. It asks the learner to observe a sample but omits the required teaching explanation.\n`;

function result(task, payload) {
  return { schemaVersion: 2, taskDigest: task.taskDigest, context: resultContextForTask(task), outcome: "COMPLETED", payload };
}

function plan(task) {
  return result(task, {
    goal: "Create one fictional offline educational fixture-reading guide.", scope: task.authorization.scope,
    allowedChanges: task.authorization.allowedChanges, forbiddenChanges: task.authorization.forbiddenChanges,
    acceptanceCriteria: task.authorization.acceptanceCriteria, validationRequirements: task.authorization.validationRequirements,
    risks: ["Fixture wording could fail an explicit content validation."],
    rationale: "The plan remains exactly within the disposable authorization.",
    resolvesFindingIds: task.purpose === "ARCHITECT_REVISION" ? task.previousEvidence.records.filter((item) => item.type === "result").map((item) => item.id) : [],
  });
}

export class OfflineFixtureTransport {
  constructor({ scenario = "success", overrides = {} } = {}) {
    if (!OFFLINE_FIXTURE_SCENARIOS.includes(scenario)) throw new Error("OFFLINE_SCENARIO_UNSUPPORTED");
    this.scenario = scenario; this.overrides = structuredClone(overrides); this.calls = 0;
  }

  execute(boundTask, boundedEvidence, executionContext) {
    const task = structuredClone(boundTask); const evidence = structuredClone(boundedEvidence); const context = structuredClone(executionContext);
    this.calls += 1;
    const frame = (type, payload, sequence = 0) => createExecutionFrame({ executionId: context.executionId, taskDigest: task.taskDigest, sequence, type, payload });
    if (this.overrides.transportFailure === task.purpose) return frame("transport_failure", { code: "OFFLINE_FIXTURE_FAILURE", message: "Injected deterministic fixture failure." });
    if (task.purpose === "ARCHITECT_PLAN" || task.purpose === "ARCHITECT_REVISION") return frame("role_result", this.overrides.roleResult ?? plan(task));
    if (task.purpose === "BUILDER_IMPLEMENTATION" && !context.toolResult) {
      const defective = this.scenario === "revision" && task.iteration === 1;
      return frame("tool_request", { operation: "write_fixture", path: "docs/learning/offline-fixture-reading.md", content: defective ? DEFECT_CONTENT : GOOD_CONTENT, expectedOperation: task.iteration === 1 ? "ADD" : "MODIFY" });
    }
    if (task.purpose === "BUILDER_IMPLEMENTATION") {
      const checkpoint = context.checkpoint; if (!checkpoint || !Array.isArray(context.validation)) return frame("transport_failure", { code: "BUILDER_EVIDENCE_MISSING", message: "Checkpoint or validation evidence is missing." });
      return frame("role_result", result(task, { candidateCommit: checkpoint.candidateCommit, parentCommit: checkpoint.parentCommit, treeId: checkpoint.treeId, changedFiles: [{ path: "docs/learning/offline-fixture-reading.md", operation: task.iteration === 1 ? "ADD" : "MODIFY", mode: "100644" }], validation: context.validation, deviations: [], blockers: [] }), 1);
    }
    if (task.purpose === "ANALYST_REVIEW") {
      const failed = context.validation.filter((item) => item.outcome === "FAIL"); const reviewState = failed.length === 0 ? "PASS" : "REVISE";
      return frame("role_result", result(task, { reviewedCommit: task.binding.reviewedCommit, reviewState, findings: failed.map((item) => `Validation failed: ${item.recipeId}`), requiredChanges: failed.map((item) => `Correct evidence for ${item.recipeId}.`), recommendations: [], validation: context.validation }));
    }
    if (task.purpose === "ARCHITECT_FINAL_DECISION") {
      const analyst = [...evidence.records].reverse().find((item) => item.type === "result" && item.content?.context?.purpose === "ANALYST_REVIEW");
      if (!analyst) return frame("transport_failure", { code: "ANALYST_EVIDENCE_MISSING", message: "Independent review evidence is missing." });
      const decision = ["PASS", "PASS_WITH_RECOMMENDATIONS"].includes(analyst.content.payload.reviewState) ? "ACCEPT" : "REVISE";
      return frame("role_result", result(task, { reviewedCommit: task.binding.reviewedCommit, analystResultDigest: sha256Canonical(analyst.content), decision, rationale: "Disposition derives from the recorded independent offline validation evidence.", recommendationDispositions: [] }));
    }
    return frame("transport_failure", { code: "UNSUPPORTED_OFFLINE_STAGE", message: task.purpose });
  }
}
