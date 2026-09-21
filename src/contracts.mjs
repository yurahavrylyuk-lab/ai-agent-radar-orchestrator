import crypto from "node:crypto";

export const PLAN_STATES = Object.freeze(["EMPTY", "READY", "IN_PROGRESS", "REVIEW", "COMPLETE", "BLOCKED"]);
export const REVIEW_STATES = Object.freeze(["NOT_STARTED", "IN_REVIEW", "PASS", "PASS_WITH_RECOMMENDATIONS", "REVISE", "REJECT", "HUMAN_REVIEW_REQUIRED"]);
export const CYCLE_STATES = Object.freeze(["QUEUED", "ACTIVE", "AWAITING_HUMAN_ROLE", "REVIEW", "ACCEPTED", "REJECTED", "ESCALATED", "HALTED"]);
export const TERMINAL_CYCLE_STATES = Object.freeze(["ACCEPTED", "REJECTED", "ESCALATED", "HALTED"]);
export const ROLE_MODELS = Object.freeze({ architect: "Astra High", builder: "Sol Medium", analyst: "Terra High" });
export const FIXED_POLICY = Object.freeze({
  zeroAdditionalPaidSpend: true,
  liveOperationsEnabled: false,
  schedulingEnabled: false,
  schedule: "0 8 * * 1,3,5",
  modelFallback: false,
  maxIterations: 3,
  maxRoleExecutionMs: 15 * 60 * 1000,
  maxCycleActiveMs: 90 * 60 * 1000,
  maxActiveCycles: 1,
  authoritativeControllers: 1,
});

export function immutable(value) {
  return Object.freeze(structuredClone(value));
}

export const PHASE2 = Object.freeze({
  schemaVersion: 2,
  maxIterations: 3,
  maxExecutionSeconds: 900,
  maxAdditionalCostUsd: 0,
  realPilotActivation: false,
  pilotPath: "docs/learning/offline-fixture-reading.md",
  pilotBranch: "self-improvement",
});

export function canonicalJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("canonical JSON cannot contain cycles");
    seen.add(value); const result = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`; seen.delete(value); return result;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    if (seen.has(value)) throw new TypeError("canonical JSON cannot contain cycles");
    seen.add(value);
    const result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`).join(",")}}`;
    seen.delete(value); return result;
  }
  throw new TypeError("canonical JSON accepts only finite JSON values");
}
export function sha256Bytes(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
export function sha256Canonical(value) { return sha256Bytes(canonicalJson(value)); }

export function parseJsonStrict(text) {
  if (typeof text !== "string") throw new TypeError("JSON input must be text");
  let index = 0;
  const whitespace = () => { while (/\s/u.test(text[index] ?? "")) index += 1; };
  const string = () => {
    const start = index; if (text[index] !== '"') throw new SyntaxError("expected JSON string"); index += 1;
    while (index < text.length) {
      if (text[index] === "\\") { index += 2; continue; }
      if (text[index] === '"') { index += 1; return JSON.parse(text.slice(start, index)); }
      if (text.charCodeAt(index) < 0x20) throw new SyntaxError("invalid control character in JSON string");
      index += 1;
    }
    throw new SyntaxError("unterminated JSON string");
  };
  const value = () => {
    whitespace(); const token = text[index];
    if (token === '"') return string();
    if (token === "{") {
      index += 1; whitespace(); const result = {}, keys = new Set(); if (text[index] === "}") { index += 1; return result; }
      while (true) {
        whitespace(); const key = string(); if (keys.has(key)) throw new SyntaxError(`duplicate JSON key: ${key}`); keys.add(key);
        whitespace(); if (text[index++] !== ":") throw new SyntaxError("expected colon"); result[key] = value(); whitespace();
        if (text[index] === "}") { index += 1; return result; } if (text[index++] !== ",") throw new SyntaxError("expected comma");
      }
    }
    if (token === "[") {
      index += 1; whitespace(); const result = []; if (text[index] === "]") { index += 1; return result; }
      while (true) { result.push(value()); whitespace(); if (text[index] === "]") { index += 1; return result; } if (text[index++] !== ",") throw new SyntaxError("expected comma"); }
    }
    for (const [literal, parsed] of [["true", true], ["false", false], ["null", null]]) if (text.startsWith(literal, index)) { index += literal.length; return parsed; }
    const match = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (match) { index += match[0].length; const parsed = Number(match[0]); if (!Number.isFinite(parsed)) throw new SyntaxError("non-finite JSON number"); return parsed; }
    throw new SyntaxError(`invalid JSON token at offset ${index}`);
  };
  const parsed = value(); whitespace(); if (index !== text.length) throw new SyntaxError("trailing JSON content"); return parsed;
}
