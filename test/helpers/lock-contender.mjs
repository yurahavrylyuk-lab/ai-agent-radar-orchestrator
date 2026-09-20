import { acquireLock } from "../../src/local-store.mjs";

const result = acquireLock(process.argv[2], { pid: process.pid, generation: 1 });
if (!result.acquired) process.exit(2);
result.release();
