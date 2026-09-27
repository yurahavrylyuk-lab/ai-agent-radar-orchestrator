import { canonicalJson, parseJsonStrict, sha256Canonical } from "./contracts.mjs";

export const ROLE_EXECUTION_PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const TRANSPORT_EVENT_TYPES = Object.freeze(["tool_request", "role_result", "transport_failure"]);
export const EXECUTOR_EVENT_TYPES = Object.freeze(["tool_request", "tool_result", "executor_failure"]);

function exactObject(value, fields, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  const keys = Object.keys(value).sort(); const expected = [...fields].sort();
  if (keys.join("\0") !== expected.join("\0")) throw new TypeError(`${name} fields are invalid`);
}

export function createExecutionFrame({ executionId, taskDigest, sequence, type, payload, allowedTypes = TRANSPORT_EVENT_TYPES }) {
  if (typeof executionId !== "string" || executionId.length === 0) throw new TypeError("executionId is required");
  if (!/^[0-9a-f]{64}$/u.test(taskDigest)) throw new TypeError("taskDigest is invalid");
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError("sequence is invalid");
  if (!allowedTypes.includes(type)) throw new TypeError("frame type is not allowed");
  const unsigned = { protocolVersion: ROLE_EXECUTION_PROTOCOL_VERSION, executionId, taskDigest, sequence, type, payload: structuredClone(payload) };
  return Object.freeze({ ...unsigned, frameDigest: sha256Canonical(unsigned) });
}

export function validateExecutionFrame(frame, { executionId, taskDigest, expectedSequence, allowedTypes = TRANSPORT_EVENT_TYPES } = {}) {
  exactObject(frame, ["protocolVersion", "executionId", "taskDigest", "sequence", "type", "payload", "frameDigest"], "frame");
  if (frame.protocolVersion !== ROLE_EXECUTION_PROTOCOL_VERSION) throw new Error("FRAME_PROTOCOL_VERSION_UNSUPPORTED");
  const rebuilt = createExecutionFrame({ executionId: frame.executionId, taskDigest: frame.taskDigest, sequence: frame.sequence, type: frame.type, payload: frame.payload, allowedTypes });
  if (rebuilt.frameDigest !== frame.frameDigest) throw new Error("FRAME_DIGEST_MISMATCH");
  if (executionId !== undefined && frame.executionId !== executionId) throw new Error("FRAME_EXECUTION_MISMATCH");
  if (taskDigest !== undefined && frame.taskDigest !== taskDigest) throw new Error("FRAME_TASK_MISMATCH");
  if (expectedSequence !== undefined && frame.sequence !== expectedSequence) throw new Error("FRAME_SEQUENCE_MISMATCH");
  return true;
}

export function encodeExecutionFrame(frame, options = {}) {
  validateExecutionFrame(frame, options);
  const body = Buffer.from(canonicalJson(frame), "utf8");
  if (body.length > MAX_FRAME_BYTES) throw new Error("FRAME_TOO_LARGE");
  return Buffer.concat([Buffer.from(`${body.length}:`, "ascii"), body]);
}

export function decodeExecutionFrame(bytes, options = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const separator = buffer.indexOf(58);
  if (separator < 1 || separator > 10) throw new Error("FRAME_PREFIX_INVALID");
  const prefix = buffer.subarray(0, separator).toString("ascii");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(prefix)) throw new Error("FRAME_PREFIX_INVALID");
  const length = Number(prefix); if (!Number.isSafeInteger(length) || length > MAX_FRAME_BYTES) throw new Error("FRAME_TOO_LARGE");
  const body = buffer.subarray(separator + 1); if (body.length !== length) throw new Error("FRAME_LENGTH_MISMATCH");
  let frame; try { frame = parseJsonStrict(body.toString("utf8")); } catch { throw new Error("FRAME_JSON_INVALID"); }
  validateExecutionFrame(frame, options); return frame;
}
