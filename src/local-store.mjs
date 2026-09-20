import fs from "node:fs";
import path from "node:path";

export function acquireLock(lockPath, owner) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(owner)}\n`);
    fs.closeSync(fd);
    return { acquired: true, release: () => { try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; } } };
  } catch (error) {
    if (error.code === "EEXIST") return { acquired: false, reason: "LOCKED_NO_STALE_TAKEOVER" };
    throw error;
  }
}
export function readState(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
export function replaceStateAtomic(filePath, value, { failBeforeRename = false } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.fsyncSync(fs.openSync(temporary, "r"));
  if (failBeforeRename) { fs.unlinkSync(temporary); throw new Error("INJECTED_PERSISTENCE_FAILURE"); }
  fs.renameSync(temporary, filePath);
}
export function commitReviewBundle(state, { iteration, summary, event }) {
  if (state.iterations.some((item) => item.id === iteration.id)) {
    const current = state.iterations.find((item) => item.id === iteration.id);
    if (JSON.stringify(current) !== JSON.stringify(iteration)) throw new Error("CONFLICTING_REVIEW");
    return structuredClone(state);
  }
  return { ...structuredClone(state), iterations: [...state.iterations, structuredClone(iteration)], summaries: [...state.summaries, structuredClone(summary)], outbox: [...state.outbox, structuredClone(event)] };
}
