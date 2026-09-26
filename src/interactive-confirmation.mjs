import readline from "node:readline";

export const INTERACTIVE_CONFIRMATION_STATES = Object.freeze({
  VALIDATING: "VALIDATING",
  PROPOSAL_READY: "PROPOSAL_READY",
  DISPLAYING: "DISPLAYING",
  WAITING_FOR_ONE_LINE: "WAITING_FOR_ONE_LINE",
  EXACT_MATCH: "EXACT_MATCH",
  ISSUING: "ISSUING",
  ISSUED: "ISSUED",
  ABORTED: "ABORTED",
});

function confirmationError(code, cause = null) {
  const error = new Error(code);
  error.code = code;
  if (cause !== null) error.cause = cause;
  return error;
}

function writeComplete(output, text) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (callback, value, retainErrorListener = false) => {
      if (finished) return;
      finished = true;
      if (!retainErrorListener) output.removeListener("error", onError);
      callback(value);
    };
    const onError = (error) => finish(reject, confirmationError("CONFIRMATION_DISPLAY_FAILED", error), true);
    output.once("error", onError);
    try {
      output.write(text, (error) => error ? onError(error) : finish(resolve));
    } catch (error) {
      onError(error);
    }
  });
}

function appendTerminatedLines(state, chunk) {
  state.buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  while (true) {
    const carriage = state.buffer.indexOf("\r");
    const newline = state.buffer.indexOf("\n");
    const indexes = [carriage, newline].filter((index) => index !== -1);
    if (indexes.length === 0) return;
    const index = Math.min(...indexes);
    const width = state.buffer[index] === "\r" && state.buffer[index + 1] === "\n" ? 2 : 1;
    state.lines.push(state.buffer.slice(0, index));
    state.buffer = state.buffer.slice(index + width);
  }
}

export async function readInteractiveConfirmation({
  input = process.stdin,
  output = process.stderr,
  displayText,
  expectedConfirmation,
  signalSource = process,
  onStateChange = () => {},
}) {
  let state = null;
  const transition = (next) => { state = next; onStateChange(next); };
  transition(INTERACTIVE_CONFIRMATION_STATES.VALIDATING);
  if (!input || input.isTTY !== true) {
    transition(INTERACTIVE_CONFIRMATION_STATES.ABORTED);
    throw confirmationError("INTERACTIVE_TTY_CONFIRMATION_REQUIRED");
  }
  if (typeof displayText !== "string" || displayText.length === 0 || typeof expectedConfirmation !== "string" || expectedConfirmation.length === 0) {
    transition(INTERACTIVE_CONFIRMATION_STATES.ABORTED);
    throw confirmationError("INTERACTIVE_CONFIRMATION_CONFIGURATION_INVALID");
  }
  transition(INTERACTIVE_CONFIRMATION_STATES.PROPOSAL_READY);

  return await new Promise((resolve, reject) => {
    let settled = false;
    let lineReader = null;
    const raw = { buffer: "", lines: [] };
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];

    const cleanup = () => {
      input.removeListener("data", onPrematureData);
      input.removeListener("data", onRawData);
      input.removeListener("error", onInputError);
      input.removeListener("end", onEnd);
      input.removeListener("close", onClose);
      for (const signal of signals) signalSource.removeListener?.(signal, onInterrupt);
      if (lineReader !== null) {
        lineReader.removeListener("line", onLine);
        lineReader.removeListener("close", onReaderClose);
        lineReader.once("error", () => {});
        lineReader.close();
      }
    };
    const abort = (code, cause = null) => {
      if (settled) return;
      settled = true;
      transition(INTERACTIVE_CONFIRMATION_STATES.ABORTED);
      cleanup();
      reject(confirmationError(code, cause));
    };
    const onPrematureData = () => abort("CONFIRMATION_INPUT_BEFORE_PROMPT");
    const onRawData = (chunk) => appendTerminatedLines(raw, chunk);
    const onInputError = (error) => abort(error?.code === "EAGAIN" ? "CONFIRMATION_INPUT_EAGAIN" : "CONFIRMATION_INPUT_ERROR", error);
    const onEnd = () => abort(raw.buffer.length === 0 ? "CONFIRMATION_EOF" : "CONFIRMATION_UNTERMINATED_INPUT");
    const onClose = () => abort(raw.buffer.length === 0 ? "CONFIRMATION_EOF" : "CONFIRMATION_UNTERMINATED_INPUT");
    const onInterrupt = () => abort("CONFIRMATION_INTERRUPTED");
    const onReaderClose = () => abort(raw.buffer.length === 0 ? "CONFIRMATION_EOF" : "CONFIRMATION_UNTERMINATED_INPUT");
    const onLine = (line) => {
      if (raw.lines.length !== 1 || raw.buffer.length !== 0 || raw.lines[0] !== line) {
        abort("DIGEST_SPECIFIC_CONFIRMATION_REQUIRED");
        return;
      }
      const received = raw.lines.shift();
      if (received !== expectedConfirmation) {
        abort("DIGEST_SPECIFIC_CONFIRMATION_REQUIRED");
        return;
      }
      if (settled) return;
      settled = true;
      transition(INTERACTIVE_CONFIRMATION_STATES.EXACT_MATCH);
      cleanup();
      resolve(received);
    };

    input.on("data", onPrematureData);
    input.once("error", onInputError);
    input.once("end", onEnd);
    input.once("close", onClose);
    for (const signal of signals) signalSource.once?.(signal, onInterrupt);
    transition(INTERACTIVE_CONFIRMATION_STATES.DISPLAYING);
    writeComplete(output, displayText).then(() => {
      if (settled) return;
      input.removeListener("data", onPrematureData);
      input.on("data", onRawData);
      lineReader = readline.createInterface({ input, terminal: false, crlfDelay: Infinity });
      lineReader.on("line", onLine);
      lineReader.once("close", onReaderClose);
      transition(INTERACTIVE_CONFIRMATION_STATES.WAITING_FOR_ONE_LINE);
    }).catch((error) => abort(error.code ?? "CONFIRMATION_DISPLAY_FAILED", error));
  });
}
