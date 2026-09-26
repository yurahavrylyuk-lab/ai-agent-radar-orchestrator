import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { INTERACTIVE_CONFIRMATION_STATES, readInteractiveConfirmation } from "../src/interactive-confirmation.mjs";
import { activationFixture, writeJson } from "./helpers/activation-fixture.mjs";
import { runDisposableAuthorizationPty } from "./helpers/interactive-confirmation-pty.mjs";

const expected = `CONFIRM ${"a".repeat(64)}`;
const displayText = `${JSON.stringify({ authorizationDigest: "a".repeat(64) })}\nType ${expected}:\n`;

function ttyInput() {
  const input = new PassThrough();
  Object.defineProperty(input, "isTTY", { value: true });
  return input;
}

function output({ delayed = false, failure = null } = {}) {
  let release = null;
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      if (delayed) release = () => callback(failure);
      else queueMicrotask(() => callback(failure));
    },
  });
  return { stream, release: () => release?.() };
}

function begin(options = {}) {
  const input = options.input ?? ttyInput();
  const sink = options.output ?? output().stream;
  const signalSource = options.signalSource ?? new EventEmitter();
  const states = [];
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const promise = readInteractiveConfirmation({ input, output: sink, displayText, expectedConfirmation: expected, signalSource, onStateChange(state) { states.push(state); if (state === INTERACTIVE_CONFIRMATION_STATES.WAITING_FOR_ONE_LINE) readyResolve(); } });
  return { input, output: sink, signalSource, states, ready, promise };
}

async function rejectLine(line, code = "DIGEST_SPECIFIC_CONFIRMATION_REQUIRED") {
  const run = begin(); await run.ready; run.input.write(`${line}\n`);
  await assert.rejects(run.promise, (error) => error.code === code);
  assert.equal(run.states.at(-1), INTERACTIVE_CONFIRMATION_STATES.ABORTED);
}

test("correct current digest succeeds after one terminated line", async () => {
  const run = begin(); await run.ready; run.input.write(`${expected}\n`);
  assert.equal(await run.promise, expected);
  assert.deepEqual(run.states, ["VALIDATING", "PROPOSAL_READY", "DISPLAYING", "WAITING_FOR_ONE_LINE", "EXACT_MATCH"]);
});

test("wrong and stale digests fail exact comparison", async () => {
  await rejectLine(`CONFIRM ${"b".repeat(64)}`);
  await rejectLine(`CONFIRM ${"c".repeat(64)}`);
});

test("empty, generic, malformed spacing, padded, and extra text fail", async () => {
  for (const line of ["", "CONFIRM", `CONFIRM  ${"a".repeat(64)}`, ` ${expected}`, `${expected} `, `${expected} approved`]) await rejectLine(line);
});

test("EOF before a response fails", async () => {
  const run = begin(); await run.ready; run.input.end();
  await assert.rejects(run.promise, (error) => error.code === "CONFIRMATION_EOF");
});

test("EOF after unterminated matching text fails", async () => {
  const run = begin(); await run.ready; run.input.end(expected);
  await assert.rejects(run.promise, (error) => ["CONFIRMATION_UNTERMINATED_INPUT", "DIGEST_SPECIFIC_CONFIRMATION_REQUIRED"].includes(error.code));
});

test("EAGAIN and generic stream errors fail closed", async () => {
  for (const [code, expectedCode] of [["EAGAIN", "CONFIRMATION_INPUT_EAGAIN"], ["EIO", "CONFIRMATION_INPUT_ERROR"]]) {
    const run = begin(); await run.ready; const rejection = assert.rejects(run.promise, (item) => item.code === expectedCode); const error = Object.assign(new Error(code), { code }); run.input.emit("error", error);
    await rejection;
  }
});

test("SIGINT, SIGTERM, and SIGHUP abort and clean up", async () => {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const source = new EventEmitter(); const run = begin({ signalSource: source }); await run.ready; source.emit(signal);
    await assert.rejects(run.promise, (error) => error.code === "CONFIRMATION_INTERRUPTED");
    assert.equal(source.listenerCount(signal), 0);
  }
});

test("pipe and file stdin fail before proposal display", async () => {
  const pipe = new PassThrough(); const sink = output().stream;
  await assert.rejects(readInteractiveConfirmation({ input: pipe, output: sink, displayText, expectedConfirmation: expected }), (error) => error.code === "INTERACTIVE_TTY_CONFIRMATION_REQUIRED");
  const file = fs.createReadStream(new URL(import.meta.url));
  await assert.rejects(readInteractiveConfirmation({ input: file, output: sink, displayText, expectedConfirmation: expected }), (error) => error.code === "INTERACTIVE_TTY_CONFIRMATION_REQUIRED");
  file.destroy();
});

test("input arriving before prompt readiness fails", async () => {
  const delayed = output({ delayed: true }); const run = begin({ output: delayed.stream }); run.input.write(`${expected}\n`); delayed.release();
  await assert.rejects(run.promise, (error) => error.code === "CONFIRMATION_INPUT_BEFORE_PROMPT");
});

test("prompt output failure prevents confirmation", async () => {
  const failed = output({ failure: new Error("display unavailable") }); const run = begin({ output: failed.stream });
  await assert.rejects(run.promise, (error) => error.code === "CONFIRMATION_DISPLAY_FAILED");
  assert.equal(run.states.includes(INTERACTIVE_CONFIRMATION_STATES.WAITING_FOR_ONE_LINE), false);
});

test("duplicate lines cannot settle or issue twice", async () => {
  const run = begin(); await run.ready; run.input.write(`${expected}\n${expected}\n`);
  await assert.rejects(run.promise, (error) => error.code === "DIGEST_SPECIFIC_CONFIRMATION_REQUIRED");
  assert.equal(run.states.filter((state) => state === INTERACTIVE_CONFIRMATION_STATES.EXACT_MATCH).length, 0);
});

test("successful reader cleanup leaves no signal listeners or hung handle", async () => {
  const source = new EventEmitter(); const run = begin({ signalSource: source }); await run.ready; run.input.write(`${expected}\n`); await run.promise;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) assert.equal(source.listenerCount(signal), 0);
  assert.equal(run.input.listenerCount("data"), 0);
});

test("automated disposable PTY waits without a ledger, then issues exactly once", () => {
  const fixture = activationFixture("interactive-pty-success");
  const requestFile = writeJson(fixture.root, "request.json", fixture.request); const approvalFile = writeJson(fixture.root, "approval.json", fixture.approval);
  const result = runDisposableAuthorizationPty({ cwd: fixture.controller.root, statePath: fixture.statePath, requestFile, approvalFile, env: { ...process.env, GOV002_TEST_DISPOSABLE_AUTHORITY: "1" } });
  assert.match(result.output, /PTY_WAITING_NO_LEDGER digest=[0-9a-f]{64}/u); assert.match(result.output, /PTY_CHILD_STATUS=0/u);
  const state = JSON.parse(fs.readFileSync(fixture.statePath, "utf8")); assert.equal(state.authorizations.length, 1); assert.equal(state.authorizations[0].lifecycle.status, "ISSUED");
  const replay = spawnSync("/usr/local/bin/node", [path.resolve("src/cli.mjs"), "authorize-pilot", "--state", fixture.statePath, "--file", requestFile, "--approval-file", approvalFile], { cwd: fixture.controller.root, encoding: "utf8", env: { ...process.env, GOV002_TEST_DISPOSABLE_AUTHORITY: "1" } });
  assert.notEqual(replay.status, 0); assert.match(replay.stderr, /AUTHORIZATION_ALREADY_RECORDED/u); assert.equal(JSON.parse(fs.readFileSync(fixture.statePath, "utf8")).authorizations.length, 1);
});

test("automated disposable PTY EOF and interruption abort without a ledger", () => {
  for (const action of ["eof", "interrupt"]) {
    const fixture = activationFixture(`interactive-pty-${action}`); const requestFile = writeJson(fixture.root, "request.json", fixture.request); const approvalFile = writeJson(fixture.root, "approval.json", fixture.approval);
    const result = runDisposableAuthorizationPty({ cwd: fixture.controller.root, statePath: fixture.statePath, requestFile, approvalFile, action, env: { ...process.env, GOV002_TEST_DISPOSABLE_AUTHORITY: "1" } });
    assert.match(result.output, /PTY_WAITING_NO_LEDGER/u); assert.match(result.output, /PTY_CHILD_STATUS=[1-9][0-9]*/u); assert.equal(fs.existsSync(fixture.statePath), false);
  }
});
