import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseJsonStrict } from "./contracts.mjs";
import { appendEvent, canonicalEqual, validateEvent } from "./outbox.mjs";
import { assertOwnership } from "./ownership.mjs";
import { dequeue } from "./queue.mjs";
import { validateCycle, validateIteration, validateMachineState, validateStateByVersion, validateSummary } from "./validate.mjs";

export class PersistenceDurabilityUncertainError extends Error {
  constructor(cause) {
    super("PERSISTENCE_DURABILITY_UNCERTAIN", { cause });
    this.name = "PersistenceDurabilityUncertainError";
    this.code = "PERSISTENCE_DURABILITY_UNCERTAIN";
    this.stateVisible = true;
  }
}

export function acquireLock(lockPath, owner) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = crypto.randomUUID();
  let fd = null;
  let created = false;
  let identity;
  try {
    fd = fs.openSync(lockPath, "wx", 0o600);
    created = true;
    identity = fs.fstatSync(fd);
    fs.writeFileSync(fd, `${JSON.stringify({ ...owner, lockToken: token })}\n`, { encoding: "utf8" });
    fs.fsyncSync(fd);
  } catch (error) {
    if (error.code === "EEXIST") return { acquired: false, reason: "LOCKED_NO_STALE_TAKEOVER" };
    if (created) {
      try { fs.unlinkSync(lockPath); } catch (cleanupError) { if (cleanupError.code !== "ENOENT") error.cleanupError = cleanupError; }
    }
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }

  let released = false;
  return {
    acquired: true,
    release() {
      if (released) return true;
      let currentFd = null;
      try {
        currentFd = fs.openSync(lockPath, "r");
        const currentIdentity = fs.fstatSync(currentFd);
        const record = JSON.parse(fs.readFileSync(currentFd, "utf8"));
        if (record.lockToken !== token || currentIdentity.dev !== identity.dev || currentIdentity.ino !== identity.ino) throw new Error("LOCK_OWNERSHIP_LOST");
        fs.unlinkSync(lockPath);
        released = true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      } finally {
        if (currentFd !== null) fs.closeSync(currentFd);
      }
      return true;
    },
  };
}

export function readState(filePath) {
  return parseJsonStrict(fs.readFileSync(filePath, "utf8"));
}

export function replaceStateAtomic(filePath, value, { failBeforeRename = false, failAfterRename = false, onOperation = () => {} } = {}) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  let temporaryFd = null;
  let temporaryOwned = false;
  let preparationFailure = null;

  try {
    temporaryFd = fs.openSync(temporary, "wx", 0o600);
    temporaryOwned = true;
    onOperation("temporary-open", temporaryFd);
    fs.writeFileSync(temporaryFd, serialized, { encoding: "utf8" });
    onOperation("temporary-write", temporaryFd);
    fs.fsyncSync(temporaryFd);
    onOperation("temporary-sync", temporaryFd);
  } catch (error) {
    preparationFailure = error;
  } finally {
    if (temporaryFd !== null) {
      try {
        fs.closeSync(temporaryFd);
        onOperation("temporary-close", temporaryFd);
      } catch (error) {
        preparationFailure ??= error;
      }
      temporaryFd = null;
    }
  }
  if (preparationFailure) {
    if (temporaryOwned) {
      try { fs.unlinkSync(temporary); } catch (cleanupError) { if (cleanupError.code !== "ENOENT") preparationFailure.cleanupError = cleanupError; }
    }
    throw preparationFailure;
  }

  try {
    if (failBeforeRename) throw new Error("INJECTED_PERSISTENCE_FAILURE_BEFORE_RENAME");
    fs.renameSync(temporary, filePath);
    temporaryOwned = false;
    onOperation("rename", null);
  } catch (error) {
    if (temporaryOwned) {
      try { fs.unlinkSync(temporary); } catch (cleanupError) { if (cleanupError.code !== "ENOENT") error.cleanupError = cleanupError; }
    }
    throw error;
  }

  let directoryFd = null;
  let durabilityFailure = null;
  try {
    directoryFd = fs.openSync(directory, "r");
    onOperation("directory-open", directoryFd);
    if (failAfterRename) throw new Error("INJECTED_DIRECTORY_SYNC_FAILURE_AFTER_RENAME");
    fs.fsyncSync(directoryFd);
    onOperation("directory-sync", directoryFd);
  } catch (error) {
    durabilityFailure = error;
  } finally {
    if (directoryFd !== null) {
      try {
        fs.closeSync(directoryFd);
        onOperation("directory-close", directoryFd);
      } catch (error) {
        durabilityFailure ??= error;
      }
    }
  }
  if (durabilityFailure) throw new PersistenceDurabilityUncertainError(durabilityFailure);
  return { durability: "CONFIRMED" };
}

function validateReviewState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new TypeError("review state must be an object");
  for (const field of ["iterations", "summaries", "outbox"]) if (!Array.isArray(state[field])) throw new TypeError(`review state ${field} must be an array`);
  if (state.iterations.length > 3) throw new TypeError("cannot persist more than three iterations");
  state.iterations.forEach(validateIteration);
  state.summaries.forEach(validateSummary);
  state.outbox.forEach(validateEvent);
  if (new Set(state.outbox.map((event) => event.id)).size !== state.outbox.length) throw new TypeError("duplicate outbox event id");
  if (state.iterations.length !== state.summaries.length) throw new TypeError("iteration and summary counts must match");
  if (new Set(state.iterations.map((iteration) => iteration.id)).size !== state.iterations.length) throw new TypeError("duplicate iteration id");
  if (new Set(state.iterations.map((iteration) => iteration.index)).size !== state.iterations.length) throw new TypeError("duplicate iteration index");
  state.iterations.forEach((iteration, index) => {
    if (iteration.index !== index + 1) throw new TypeError("iteration indices must be contiguous from 1");
    const summary = state.summaries[index];
    if (summary.cycleId !== iteration.cycleId || summary.iterationCount !== iteration.index) throw new TypeError("review summary does not match iteration");
    if (index > 0 && (iteration.cycleId !== state.iterations[0].cycleId || iteration.planRevision !== state.iterations[0].planRevision)) throw new TypeError("inconsistent review iteration references");
  });
  if (state.stateVersion !== undefined && (!Number.isSafeInteger(state.stateVersion) || state.stateVersion < 0)) throw new TypeError("review state version is invalid");
  return true;
}

export function commitReviewBundle(state, { iteration, summary, event }) {
  validateReviewState(state);
  validateIteration(iteration);
  validateSummary(summary);
  validateEvent(event);
  if (summary.cycleId !== iteration.cycleId || summary.iterationCount !== iteration.index) throw new TypeError("review bundle references are inconsistent");

  const existingIndex = state.iterations.findIndex((item) => item.id === iteration.id);
  let candidate;
  if (existingIndex !== -1) {
    if (!canonicalEqual(state.iterations[existingIndex], iteration)) throw new Error("CONFLICTING_REVIEW");
    if (!canonicalEqual(state.summaries[existingIndex], summary)) throw new Error("CONFLICTING_SUMMARY");
    candidate = { ...structuredClone(state), outbox: appendEvent(state.outbox, event) };
  } else {
    if (state.iterations.length >= 3 || iteration.index !== state.iterations.length + 1) throw new Error("ITERATION_LIMIT_OR_SEQUENCE_VIOLATION");
    if (state.iterations.length > 0 && (iteration.cycleId !== state.iterations[0].cycleId || iteration.planRevision !== state.iterations[0].planRevision)) throw new Error("INCONSISTENT_REVIEW_REFERENCES");
    candidate = {
      ...structuredClone(state),
      iterations: [...state.iterations, structuredClone(iteration)],
      summaries: [...state.summaries, structuredClone(summary)],
      outbox: appendEvent(state.outbox, event),
    };
  }
  const changed = !canonicalEqual(candidate, state);
  if (changed && state.stateVersion !== undefined) candidate.stateVersion = state.stateVersion + 1;
  validateReviewState(candidate);
  return candidate;
}

export function persistReviewBundle(filePath, bundle, options = {}) {
  const state = readState(filePath);
  const candidate = commitReviewBundle(state, bundle);
  if (canonicalEqual(candidate, state)) return { changed: false, state: candidate };
  replaceStateAtomic(filePath, candidate, options);
  return { changed: true, state: candidate };
}

export function admitNextCycle({ statePath, lockPath, claim, cycle, now, persistenceOptions = {} }) {
  const lock = acquireLock(lockPath, { controllerId: claim.ownerId, generation: claim.generation, pid: process.pid });
  if (!lock.acquired) return { status: "LOCKED", reason: lock.reason };
  try {
    const state = readState(statePath);
    validateMachineState(state);
    assertOwnership(state, claim);
    if (state.activeCycleId !== null) return { status: "ACTIVE_CYCLE_PRESENT" };
    if (state.humanHold) return { status: "HUMAN_HOLD" };
    const selected = dequeue(state.queue, { activeCycleId: state.activeCycleId, humanHold: state.humanHold, now });
    if (selected.request === null) return { status: "NO_ELIGIBLE_REQUEST" };

    validateCycle(cycle);
    if (cycle.status !== "ACTIVE" || cycle.iterationIds.length !== 0) throw new Error("NEW_CYCLE_MUST_START_ACTIVE_WITHOUT_ITERATIONS");
    if (state.cycles.some((existing) => existing.id === cycle.id)) throw new Error("CYCLE_ID_ALREADY_USED");
    if (state.cycles.some((existing) => existing.requestId === cycle.requestId)) throw new Error("REQUEST_ALREADY_CLAIMED");
    if (cycle.requestId !== selected.request.id) throw new Error("REQUEST_IS_NOT_NEXT_ELIGIBLE");

    const candidate = {
      ...structuredClone(state),
      stateVersion: state.stateVersion + 1,
      activeCycleId: cycle.id,
      queue: selected.queue,
      cycles: [...state.cycles, structuredClone(cycle)],
    };
    validateMachineState(candidate);
    replaceStateAtomic(statePath, candidate, persistenceOptions);
    return { status: "ADMITTED", cycle: structuredClone(cycle), stateVersion: candidate.stateVersion };
  } finally {
    lock.release();
  }
}

export function initializeStateV2(filePath, state) {
  validateStateByVersion(state);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const serialized = `${JSON.stringify(state, null, 2)}\n`; let fd = null;
  try {
    fd = fs.openSync(filePath, "wx", 0o600); fs.writeFileSync(fd, serialized, "utf8"); fs.fsyncSync(fd);
  } finally { if (fd !== null) fs.closeSync(fd); }
  const directoryFd = fs.openSync(path.dirname(filePath), "r"); try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  return structuredClone(state);
}

export function mutateStateV2({ statePath, ownerId, ownerGeneration, mutator, persistenceOptions = {} }) {
  const lockPath = `${statePath}.lock`;
  const lock = acquireLock(lockPath, { controllerId: ownerId, generation: ownerGeneration, pid: process.pid });
  if (!lock.acquired) { const error = new Error(lock.reason); error.code = "STATE_LOCKED"; throw error; }
  try {
    const state = readState(statePath); validateStateByVersion(state);
    if (state.owner.id !== ownerId) throw new Error("WRONG_OWNER");
    if (state.owner.generation !== ownerGeneration) throw new Error("STALE_GENERATION");
    const originalVersion = state.stateVersion;
    const operation = mutator(structuredClone(state));
    if (operation?.unchanged === true) return { state: structuredClone(state), value: operation.value, changed: false };
    const candidate = operation?.state ?? operation;
    if (!candidate || candidate.stateVersion !== originalVersion + 1) throw new Error("STATE_VERSION_MUST_ADVANCE_EXACTLY_ONCE");
    validateStateByVersion(candidate); replaceStateAtomic(statePath, candidate, persistenceOptions);
    return { state: structuredClone(candidate), value: operation?.value, changed: true };
  } finally { lock.release(); }
}
