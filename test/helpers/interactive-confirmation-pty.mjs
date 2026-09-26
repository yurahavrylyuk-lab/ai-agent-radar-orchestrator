import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readInteractiveConfirmation } from "../../src/interactive-confirmation.mjs";

const expectProgram = "/usr/bin/expect";
const node = "/usr/local/bin/node";
const cli = fileURLToPath(new URL("../../src/cli.mjs", import.meta.url));

const expectScript = String.raw`
set timeout 30
set node $env(GOV002_PTY_NODE)
set cli $env(GOV002_PTY_CLI)
set state $env(GOV002_PTY_STATE)
set request $env(GOV002_PTY_REQUEST)
set approval $env(GOV002_PTY_APPROVAL)
set action $env(GOV002_PTY_ACTION)
spawn -noecho $node $cli authorize-pilot --state $state --file $request --approval-file $approval
expect {
  -re {"authorizationDigest": "([0-9a-f]{64})"} { set digest $expect_out(1,string) }
  timeout { puts "PTY_TIMEOUT_BEFORE_DIGEST"; exit 80 }
  eof { puts "PTY_EOF_BEFORE_DIGEST"; exit 81 }
}
expect {
  -exact "Type CONFIRM $digest to issue this single-use authorization:" {}
  timeout { puts "PTY_TIMEOUT_BEFORE_PROMPT"; exit 82 }
  eof { puts "PTY_EOF_BEFORE_PROMPT"; exit 83 }
}
if {[file exists $state]} { puts "PTY_LEDGER_EXISTED_WHILE_WAITING"; exit 84 }
puts "PTY_WAITING_NO_LEDGER digest=$digest"
if {$action eq "confirm"} {
  send -- "CONFIRM $digest\r"
} elseif {$action eq "eof"} {
  send -- "\004"
} elseif {$action eq "interrupt"} {
  send -- "\003"
} else {
  puts "PTY_UNKNOWN_ACTION"
  exit 85
}
expect eof
set waited [wait]
set childStatus [lindex $waited 3]
puts "PTY_CHILD_STATUS=$childStatus"
if {$action eq "confirm" && $childStatus != 0} { exit 86 }
if {$action ne "confirm" && $childStatus == 0} { exit 87 }
exit 0
`;

export function runDisposableAuthorizationPty({ cwd, statePath, requestFile, approvalFile, action = "confirm", env = process.env }) {
  const ptyEnv = { ...env, GOV002_PTY_NODE: node, GOV002_PTY_CLI: cli, GOV002_PTY_STATE: statePath, GOV002_PTY_REQUEST: requestFile, GOV002_PTY_APPROVAL: approvalFile, GOV002_PTY_ACTION: action };
  const result = spawnSync(expectProgram, ["-c", expectScript], { cwd, encoding: "utf8", env: ptyEnv });
  if (result.status !== 0) throw new Error(`DISPOSABLE_PTY_FAILED:${result.status}\n${result.stdout}\n${result.stderr}`);
  return Object.freeze({ output: `${result.stdout}${result.stderr}`, status: result.status });
}

async function humanDisposablePrompt() {
  const digest = crypto.createHash("sha256").update(`gov002-disposable-human-pty:${process.pid}:${Date.now()}`).digest("hex");
  const expectedConfirmation = `CONFIRM ${digest}`;
  const displayText = `${JSON.stringify({ disposableFixture: true, authorizationDigest: digest }, null, 2)}\nType ${expectedConfirmation} to complete this disposable input test:\n`;
  await readInteractiveConfirmation({ displayText, expectedConfirmation });
  process.stdout.write(`${JSON.stringify({ status: "DISPOSABLE_CONFIRMATION_ACCEPTED", digest }, null, 2)}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  humanDisposablePrompt().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error.code ?? error.message, message: error.message })}\n`);
    process.exitCode = 1;
  });
}
