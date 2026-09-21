import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { sha256Bytes } from "../src/contracts.mjs";
import { readState } from "../src/local-store.mjs";
import { migrateStateV1ToV2 } from "../src/state-migration.mjs";
import { approval, runtimeDirectory } from "./helpers/phase2-fixture.mjs";

function legacy(root, overrides = {}) { const statePath = path.join(root, "state.json"); const state = { schemaVersion: 1, controllerId: "controller", stateVersion: 4, owner: { id: "owner", generation: 2 }, activeCycleId: null, humanHold: false, queue: [], cycles: [], ...overrides }; fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`); return { statePath, state }; }
const migrate = (root, statePath, persistenceOptions = {}) => migrateStateV1ToV2({ statePath, evidenceRoot: path.join(root, "migration-evidence"), repositoryId: "fixture-repository", evidenceMode: "SIMULATED", approval, now: "2026-09-21T00:00:00.000Z", persistenceOptions });

test("explicit v1 migration preserves exact source bytes and installs a validated v2 state", () => {
  const root = runtimeDirectory("migration"); const { statePath } = legacy(root); const bytes = fs.readFileSync(statePath); const result = migrate(root, statePath); assert.equal(result.sourceDigest, sha256Bytes(bytes)); assert.deepEqual(fs.readFileSync(result.evidencePath), bytes); const state = readState(statePath); assert.equal(state.schemaVersion, 2); assert.equal(state.stateVersion, 5); assert.equal(state.migration.sourceDigest, result.sourceDigest);
});
test("migration refuses unknown, corrupt, duplicate-key, active, held, and already-v2 input", () => {
  for (const [name, content, pattern] of [
    ["unknown", JSON.stringify({ schemaVersion: 9 }), /UNKNOWN/], ["corrupt", "{", /JSON|token|unterminated/u], ["duplicate", '{"schemaVersion":1,"schemaVersion":1}', /duplicate/],
  ]) { const root = runtimeDirectory(`migration-${name}`); const statePath = path.join(root, "state.json"); fs.writeFileSync(statePath, content); assert.throws(() => migrate(root, statePath), pattern); }
  const activeRoot = runtimeDirectory("migration-active"); const activeCycle = { id: "c", requestId: "r", status: "ACTIVE", planRevision: 1, baseline: "base", iterationIds: [], activeMs: 0, humanWaitingMs: 0, liveOperationsEnabled: false }; const { statePath: activePath } = legacy(activeRoot, { activeCycleId: "c", cycles: [activeCycle] }); assert.throws(() => migrate(activeRoot, activePath), /ACTIVE_OR_HELD/);
  const heldRoot = runtimeDirectory("migration-held"); const { statePath: heldPath } = legacy(heldRoot, { humanHold: true }); assert.throws(() => migrate(heldRoot, heldPath), /ACTIVE_OR_HELD/);
});
test("pre-rename migration failure keeps v1; post-rename uncertainty exposes complete v2 and never fabricates evidence", () => {
  const pre = runtimeDirectory("migration-pre"); const { statePath: prePath } = legacy(pre); assert.throws(() => migrate(pre, prePath, { failBeforeRename: true }), /INJECTED/); assert.equal(readState(prePath).schemaVersion, 1);
  const post = runtimeDirectory("migration-post"); const { statePath: postPath } = legacy(post); assert.throws(() => migrate(post, postPath, { failAfterRename: true }), /PERSISTENCE_DURABILITY_UNCERTAIN/); assert.equal(readState(postPath).schemaVersion, 2);
});
