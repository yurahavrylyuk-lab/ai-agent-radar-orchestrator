import { integrateRealCandidate } from "../../src/real-local-integration.mjs";

try {
  const result = integrateRealCandidate({ statePath: process.argv[2], cycleId: process.argv[3], controllerRoot: process.argv[4], now: process.argv[5] });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error.code ?? error.message}\n`);
  process.exitCode = 2;
}
