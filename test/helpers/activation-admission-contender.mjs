import { admitRealPilotRequest } from "../../src/real-pilot-admission.mjs";

try {
  const result = admitRealPilotRequest({ statePath: process.argv[2], request: JSON.parse(process.argv[3]), controllerRoot: process.argv[4], now: process.argv[5] });
  process.stdout.write(`${result.status}\n`);
} catch (error) {
  process.stderr.write(`${error.code ?? error.message}\n`);
  process.exitCode = 2;
}
