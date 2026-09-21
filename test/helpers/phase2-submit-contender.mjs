import fs from "node:fs";
import { parseJsonStrict } from "../../src/contracts.mjs";
import { submitRoleResult } from "../../src/result-submission.mjs";

const [statePath, resultPath] = process.argv.slice(2);
try {
  const result = parseJsonStrict(fs.readFileSync(resultPath, "utf8"));
  submitRoleResult({ statePath, ownerId: "owner", ownerGeneration: 1, result, now: "2026-09-21T00:01:00.000Z" });
  process.stdout.write("SUBMISSION_ACCEPTED\n");
} catch (error) {
  process.stderr.write(`${error.code ?? error.message}\n`); process.exitCode = 2;
}
