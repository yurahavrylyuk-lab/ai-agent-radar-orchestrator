import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { alternates, changedFiles, commitMetadata, currentBranch, inspectGit, remotes, resolveCommit, statusPorcelain } from "../git-evidence.mjs";
import { sha256Canonical } from "../contracts.mjs";

export const AI_RADAR_SEARCH10_SCENARIO = "ai-radar-search10";
export const AI_RADAR_SEARCH10_BASELINE = "33a60a1f74960f9c171f5449627db1be362c6481";
export const AI_RADAR_SEARCH10_BRANCH = "self-improvement-search10-test";
export const AI_RADAR_SEARCH10_REPOSITORY_PREFIX = "offline-repository:ai-radar-search10:";
export const AI_RADAR_PROTECTED_ROOT = "/Users/yuriy/Documents/IT Study/General/General/AI Agents/The AI Monitoring Agent";

export const AI_RADAR_SEARCH10_QUERIES = Object.freeze([
  "AI news research product announcements",
  "AI agent framework releases",
  "AI model releases capabilities",
  "AI programming software development techniques",
  "AI developer tools releases",
  "Claude developer features releases",
  "Codex coding features releases",
  "AI coding tools releases",
  "AI assisted development workflow examples",
  "useful AI IT tools workflow tutorials",
]);

export const AI_RADAR_SEARCH10_ALLOWED_CHANGES = Object.freeze([
  { path: "src/services/monitor.ts", operation: "MODIFY" },
  { path: "src/tools/webSearch.ts", operation: "MODIFY" },
  { path: "test/monitor.test.ts", operation: "MODIFY" },
  { path: "test/webSearch.test.ts", operation: "ADD" },
]);

export const AI_RADAR_SEARCH10_VALIDATIONS = Object.freeze([
  { id: "validate-ai-radar-reviewed-diff", description: "Verify the cumulative candidate changes exactly the four reviewed files and exact post-image objects." },
  { id: "validate-ai-radar-search-behavior", description: "Verify the fixed ordered queries, typed guard stop, sequential collection, explicit-query compatibility, count five, and one-analysis cap." },
  { id: "validate-ai-radar-offline-checks", description: "Run the existing build, test suite, and Worker TypeScript check with network denied." },
  { id: "validate-ai-radar-protected-surfaces", description: "Verify Worker, Gemini, notification, D1, Cron, package, lock, limits, secrets, and provider capabilities are unchanged." },
]);

const EXPECTED = Object.freeze({
  "src/services/monitor.ts": { before: "661c0d79aab2be7800d9f17f4c76a3413417f100af2aa5fb81b94fce5d64d871", after: "b4cc64f4ef2b7507dbdfc3331641edd3b6127796b34ea57a0fdb31da00c99eb4" },
  "src/tools/webSearch.ts": { before: "47d234440a1c45e5817834f4c4ff5c9bbc32a7b5974256657de4d4c6944f9710", after: "3db2ad9451b95f5d63622d3aa32ab003ce27c4c50e5b4c04c24babbf1441e86f" },
  "test/monitor.test.ts": { before: "120b9f092c3fab89416023c4d1574d3567d37f12cf5378fd7a8ad6e27322b812", after: "6328f4cdf81ff95111ca60fe674fd5d26f63ffef0633d57be0fe818fcf29bca7" },
  "test/webSearch.test.ts": { before: null, after: "e5b431db0b844fc24e8088936fc195a88e74e0cda632bd502ec45e7afcfabe80" },
});

const MONITOR_IMPORT_BEFORE = 'import { searchWeb } from "../tools/webSearch.js";';
const MONITOR_IMPORT_AFTER = 'import { BraveUsageGuardDeniedError, searchWeb } from "../tools/webSearch.js";';
const MONITOR_CONSTANT_BEFORE = 'export const MONITORING_QUERY = "new AI agent developer tool framework release";\nexport const MAX_NEW_ANALYSES_PER_CYCLE = 1;';
const MONITOR_CONSTANT_AFTER = `export const MONITORING_QUERY = "new AI agent developer tool framework release";
export const MONITORING_QUERIES = [
${AI_RADAR_SEARCH10_QUERIES.map((query) => `  ${JSON.stringify(query)},`).join("\n")}
] as const;
export const MAX_NEW_ANALYSES_PER_CYCLE = 1;`;
const MONITOR_SEARCH_BEFORE = `export async function runMonitoringCycle(
  query = MONITORING_QUERY,
  dependencies: MonitoringCycleDependencies = {},
): Promise<MonitoringCycleResult> {
  const search = dependencies.search ?? ((searchQuery: string) => searchWeb(searchQuery, { usageTracker: new LocalJsonBraveUsageStore() }));
  let searchResults: SearchResult[];
  try {
    searchResults = await search(query);
  } catch (error) {
    throw new Error(\`Monitoring cycle search failed: \${errorMessage(error)}\`);
  }

  const result = emptyResult(query, searchResults.length);`;
const MONITOR_SEARCH_AFTER = `export async function runMonitoringCycle(
  query: string | undefined = undefined,
  dependencies: MonitoringCycleDependencies = {},
): Promise<MonitoringCycleResult> {
  const search = dependencies.search ?? ((searchQuery: string) => searchWeb(searchQuery, { usageTracker: new LocalJsonBraveUsageStore() }));
  const queries = query === undefined ? MONITORING_QUERIES : [query];
  const searchResults: SearchResult[] = [];
  for (const searchQuery of queries) {
    try {
      searchResults.push(...await search(searchQuery));
    } catch (error) {
      if (query === undefined && error instanceof BraveUsageGuardDeniedError) break;
      throw new Error(\`Monitoring cycle search failed: \${errorMessage(error)}\`);
    }
  }

  const result = emptyResult(query ?? MONITORING_QUERIES.join(" | "), searchResults.length);`;

const WEB_SEARCH_INTERFACE = `export interface SearchWebDependencies {
  usageTracker?: BraveUsageStore;
  environment?: RuntimeEnvironment;
  fetchImplementation?: typeof fetch;
}`;
const WEB_SEARCH_INTERFACE_WITH_ERROR = `${WEB_SEARCH_INTERFACE}

/** Signals that the existing Brave usage guard denied a request. */
export class BraveUsageGuardDeniedError extends Error {
  constructor() {
    super("Brave search request blocked by usage guard.");
    this.name = "BraveUsageGuardDeniedError";
  }
}`;
const WEB_SEARCH_GUARD_BEFORE = `  if (!usageCheck.allowed) {
    throw new Error("Brave search request blocked by usage guard.");
  }`;
const WEB_SEARCH_GUARD_AFTER = `  if (!usageCheck.allowed) {
    throw new BraveUsageGuardDeniedError();
  }`;

const MONITOR_TEST_IMPORT_BEFORE = 'import { MAX_NEW_ANALYSES_PER_CYCLE, MONITORING_QUERY, runMonitoringCycle } from "../src/services/monitor.js";';
const MONITOR_TEST_IMPORT_AFTER = `import { MAX_NEW_ANALYSES_PER_CYCLE, MONITORING_QUERIES, MONITORING_QUERY, runMonitoringCycle } from "../src/services/monitor.js";
import { BraveUsageGuardDeniedError } from "../src/tools/webSearch.js";`;
const MONITOR_TEST_ANCHOR = `const notification = (status: NotificationResult["status"]): NotificationResult => {
  if (status === "not_eligible") return { status };
  return { status, record: { normalizedUrl: "https://example.com/record", channel: "email", sentAt: "2026-09-19T14:00:00.000Z", providerMessageId: "email_123" } };
};`;
const MONITOR_TESTS = String.raw`

test("default monitoring invokes the exact ten reviewed queries once and in order", async () => {
  const queries: string[] = [];
  await runMonitoringCycle(undefined, {
    search: async (query) => { queries.push(query); return []; },
  });
  assert.deepEqual(queries, [...MONITORING_QUERIES]);
  assert.equal(new Set(queries).size, 10);
});

test("an explicit query preserves single-search behavior", async () => {
  const queries: string[] = [];
  await runMonitoringCycle("some query", {
    search: async (query) => { queries.push(query); return []; },
  });
  assert.deepEqual(queries, ["some query"]);
});

test("guard denial preserves earlier query results and stops later collection", async () => {
  const first = searchResult("first-query");
  const second = searchResult("second-query");
  const searches: string[] = [];
  const processedUrls: string[] = [];
  const outcome = await runMonitoringCycle(undefined, {
    search: async (query) => {
      searches.push(query);
      if (searches.length === 1) return [first];
      if (searches.length === 2) return [second];
      throw new BraveUsageGuardDeniedError();
    },
    hasDiscovery: async () => true,
    process: async (item) => { processedUrls.push(item.url); return processed(item, "duplicate"); },
    notify: async () => notification("not_eligible"),
  });
  assert.deepEqual(searches, [...MONITORING_QUERIES.slice(0, 3)]);
  assert.deepEqual(processedUrls, [first.url, second.url]);
  assert.equal(outcome.searchResultsReceived, 2);
  assert.equal(outcome.resultsProcessed, 2);
});

test("cross-query results reach the existing processing loop in query and provider order", async () => {
  const processedUrls: string[] = [];
  const outcome = await runMonitoringCycle(undefined, {
    search: async (query) => {
      const index = MONITORING_QUERIES.indexOf(query as (typeof MONITORING_QUERIES)[number]);
      return [searchResult(String(index) + "-a"), searchResult(String(index) + "-b")];
    },
    hasDiscovery: async () => true,
    process: async (item) => { processedUrls.push(item.url); return processed(item, "duplicate"); },
    notify: async () => notification("not_eligible"),
  });
  assert.equal(outcome.searchResultsReceived, 20);
  assert.deepEqual(processedUrls, Array.from({ length: 10 }, (_, index) => [
    "https://example.com/" + index + "-a",
    "https://example.com/" + index + "-b",
  ]).flat());
});

test("the one-analysis cap applies across the full default query batch", async () => {
  let processCalls = 0;
  const outcome = await runMonitoringCycle(undefined, {
    search: async (query) => [searchResult(String(MONITORING_QUERIES.indexOf(query as (typeof MONITORING_QUERIES)[number])))],
    hasDiscovery: async () => false,
    process: async (item) => { processCalls += 1; return processed(item, "new"); },
    notify: async () => notification("not_eligible"),
  });
  assert.equal(MAX_NEW_ANALYSES_PER_CYCLE, 1);
  assert.equal(processCalls, 1);
  assert.equal(outcome.analysesAttempted, 1);
  assert.equal(outcome.stoppedByAnalysisCap, true);
});

test("a non-guard failure during default collection retains abort behavior", async () => {
  let searches = 0;
  let processCalls = 0;
  await assert.rejects(runMonitoringCycle(undefined, {
    search: async () => {
      searches += 1;
      if (searches === 2) throw new Error("Brave unavailable");
      return [searchResult("collected-before-failure")];
    },
    process: async (item) => { processCalls += 1; return processed(item, "new"); },
  }), /Monitoring cycle search failed: Brave unavailable/);
  assert.equal(searches, 2);
  assert.equal(processCalls, 0);
});`;

const WEB_SEARCH_TEST = `import assert from "node:assert/strict";
import test from "node:test";

import { MONITORING_QUERIES, runMonitoringCycle } from "../src/services/monitor.js";
import { BraveUsageGuardDeniedError, searchWeb } from "../src/tools/webSearch.js";
import type { UsageRecord, UsageTracker } from "../src/services/usageTracker.js";

const baseEnvironment = {
  BRAVE_SEARCH_API_KEY: "test-key",
  BRAVE_DAILY_SEARCH_LIMIT: "10",
  BRAVE_WEEKLY_SEARCH_LIMIT: "50",
  BRAVE_MONTHLY_SEARCH_LIMIT: "200",
};

class InMemoryUsageTracker implements UsageTracker {
  public readonly records: UsageRecord[];
  public recordCalls = 0;

  constructor(initialCount = 0, private readonly unavailable = false) {
    this.records = initialCount === 0 ? [] : [{
      timestamp: new Date().toISOString(),
      provider: "brave",
      operation: "web-search",
      requestCount: initialCount,
    }];
  }

  async getRecords(): Promise<UsageRecord[]> {
    if (this.unavailable) throw new Error("usage unavailable");
    return this.records;
  }

  async recordRequest(record: UsageRecord): Promise<void> {
    this.recordCalls += 1;
    this.records.push(record);
  }
}

function braveResponse(): Response {
  return new Response(JSON.stringify({ web: { results: [] } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function runDefaultSearches(
  tracker: InMemoryUsageTracker,
  environment: Record<string, string | undefined> = baseEnvironment,
): Promise<{ fetches: number; bodies: unknown[] }> {
  let fetches = 0;
  const bodies: unknown[] = [];
  await runMonitoringCycle(undefined, {
    search: (query) => searchWeb(query, {
      usageTracker: tracker,
      environment,
      fetchImplementation: async (_url, init) => {
        fetches += 1;
        bodies.push(JSON.parse(String(init?.body)));
        return braveResponse();
      },
    }),
  });
  return { fetches, bodies };
}

test("daily usage 0 permits ten sequential guarded fetches with count 5", async () => {
  const tracker = new InMemoryUsageTracker(0);
  const result = await runDefaultSearches(tracker);
  assert.equal(result.fetches, 10);
  assert.equal(tracker.recordCalls, 10);
  assert.deepEqual(result.bodies, MONITORING_QUERIES.map((q) => ({ q, count: 5 })));
});

test("daily usage 3 permits seven fetches and then stops without retry", async () => {
  const tracker = new InMemoryUsageTracker(3);
  const result = await runDefaultSearches(tracker);
  assert.equal(result.fetches, 7);
  assert.equal(tracker.recordCalls, 7);
  assert.deepEqual(result.bodies, MONITORING_QUERIES.slice(0, 7).map((q) => ({ q, count: 5 })));
});

test("daily usage 10 blocks all fetches without retry or usage increment", async () => {
  const tracker = new InMemoryUsageTracker(10);
  const result = await runDefaultSearches(tracker);
  assert.equal(result.fetches, 0);
  assert.equal(tracker.recordCalls, 0);
});

test("weekly denial stops collection before fetch", async () => {
  const tracker = new InMemoryUsageTracker(1);
  const result = await runDefaultSearches(tracker, {
    ...baseEnvironment,
    BRAVE_DAILY_SEARCH_LIMIT: "100",
    BRAVE_WEEKLY_SEARCH_LIMIT: "1",
  });
  assert.equal(result.fetches, 0);
  assert.equal(tracker.recordCalls, 0);
});

test("monthly denial stops collection before fetch", async () => {
  const tracker = new InMemoryUsageTracker(1);
  const result = await runDefaultSearches(tracker, {
    ...baseEnvironment,
    BRAVE_DAILY_SEARCH_LIMIT: "100",
    BRAVE_WEEKLY_SEARCH_LIMIT: "100",
    BRAVE_MONTHLY_SEARCH_LIMIT: "1",
  });
  assert.equal(result.fetches, 0);
  assert.equal(tracker.recordCalls, 0);
});

test("usage verification failure causes no fetch and no retry", async () => {
  const tracker = new InMemoryUsageTracker(0, true);
  const result = await runDefaultSearches(tracker);
  assert.equal(result.fetches, 0);
  assert.equal(tracker.recordCalls, 0);
});

test("guard denial uses a provider-neutral typed error", async () => {
  const tracker = new InMemoryUsageTracker(10);
  await assert.rejects(searchWeb("test", {
    usageTracker: tracker,
    environment: baseEnvironment,
    fetchImplementation: async () => { throw new Error("fetch must not run"); },
  }), (error) => {
    assert.ok(error instanceof BraveUsageGuardDeniedError);
    assert.equal(error.message, "Brave search request blocked by usage guard.");
    return true;
  });
});
`;

function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function replaceExact(content, before, after, code) {
  const first = content.indexOf(before);
  if (first < 0 || content.indexOf(before, first + before.length) >= 0) throw new Error(`AI_RADAR_SEARCH10_PRECONDITION_FAILED:${code}`);
  return `${content.slice(0, first)}${after}${content.slice(first + before.length)}`;
}
function verifyFile(root, relative, expected) {
  const file = path.join(root, relative);
  if (expected === null) {
    if (fs.existsSync(file)) throw new Error(`AI_RADAR_SEARCH10_PRECONDITION_FAILED:${relative}:expected-absent`);
    return;
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) !== 0 || digest(fs.readFileSync(file)) !== expected) throw new Error(`AI_RADAR_SEARCH10_PRECONDITION_FAILED:${relative}`);
}

export function isAiRadarSearch10RepositoryId(repositoryId) {
  return typeof repositoryId === "string" && repositoryId.startsWith(AI_RADAR_SEARCH10_REPOSITORY_PREFIX);
}

export function aiRadarSearch10Approval(runId) {
  return {
    approvalId: `offline-authorization:${runId}`,
    scope: "Apply only the fixed reviewed ten-query AI Radar search scenario in a disposable clone.",
    allowedChanges: structuredClone(AI_RADAR_SEARCH10_ALLOWED_CHANGES),
    forbiddenChanges: ["No protected target mutation", "No generated queries", "No retries", "No providers", "No network", "No publication", "No deployment", "No scheduling", "No package or lock changes"],
    acceptanceCriteria: [{ id: "ai-radar-search10", description: "The exact reviewed ten-query behavior passes all fixed offline checks in the disposable candidate." }],
    validationRequirements: structuredClone(AI_RADAR_SEARCH10_VALIDATIONS),
  };
}

export function validateAiRadarSearch10Source(sourceRoot) {
  const requested = path.resolve(sourceRoot);
  const leaf = fs.lstatSync(requested);
  if (!leaf.isDirectory() || leaf.isSymbolicLink()) throw new Error("AI_RADAR_SEARCH10_SOURCE_ROOT_INVALID");
  const canonical = fs.realpathSync(requested);
  if (canonical !== requested) throw new Error("AI_RADAR_SEARCH10_SOURCE_ROOT_NOT_CANONICAL");
  const allowedRoots = [...new Set([fs.realpathSync(os.tmpdir()), fs.realpathSync("/private/tmp")])];
  if (!allowedRoots.some((root) => { const relative = path.relative(root, canonical); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); })) throw new Error("AI_RADAR_SEARCH10_DISPOSABLE_SOURCE_REQUIRED");
  if (canonical === fs.realpathSync(AI_RADAR_PROTECTED_ROOT)) throw new Error("AI_RADAR_SEARCH10_PROTECTED_SOURCE_FORBIDDEN");
  const gitDirectory = path.join(canonical, ".git"); const gitStat = fs.lstatSync(gitDirectory);
  if (!gitStat.isDirectory() || gitStat.isSymbolicLink() || fs.realpathSync(gitDirectory) !== gitDirectory) throw new Error("AI_RADAR_SEARCH10_INDEPENDENT_GIT_REQUIRED");
  const common = inspectGit(canonical, ["rev-parse", "--git-common-dir"]).stdout.toString("utf8").trim();
  if (fs.realpathSync(path.resolve(canonical, common)) !== gitDirectory || remotes(canonical).length !== 0 || alternates(canonical)) throw new Error("AI_RADAR_SEARCH10_INDEPENDENT_GIT_REQUIRED");
  if (currentBranch(canonical) !== AI_RADAR_SEARCH10_BRANCH || resolveCommit(canonical) !== AI_RADAR_SEARCH10_BASELINE || statusPorcelain(canonical) !== "") throw new Error("AI_RADAR_SEARCH10_SOURCE_STATE_INVALID");
  for (const [relative, hashes] of Object.entries(EXPECTED)) verifyFile(canonical, relative, hashes.before);
  const stat = fs.lstatSync(canonical);
  return Object.freeze({ canonicalPath: canonical, branch: AI_RADAR_SEARCH10_BRANCH, commit: AI_RADAR_SEARCH10_BASELINE, gitDirectory, device: stat.dev, inode: stat.ino, owner: stat.uid, mode: stat.mode & 0o7777, independentGit: true, clean: true });
}

export function applyAiRadarSearch10(workspaceRoot) {
  const root = fs.realpathSync(workspaceRoot);
  for (const [relative, hashes] of Object.entries(EXPECTED)) verifyFile(root, relative, hashes.before);
  let monitor = fs.readFileSync(path.join(root, "src/services/monitor.ts"), "utf8");
  monitor = replaceExact(monitor, MONITOR_IMPORT_BEFORE, MONITOR_IMPORT_AFTER, "monitor-import");
  monitor = replaceExact(monitor, MONITOR_CONSTANT_BEFORE, MONITOR_CONSTANT_AFTER, "monitor-queries");
  monitor = replaceExact(monitor, MONITOR_SEARCH_BEFORE, MONITOR_SEARCH_AFTER, "monitor-search");
  fs.writeFileSync(path.join(root, "src/services/monitor.ts"), monitor, { encoding: "utf8", mode: 0o644 });
  let webSearch = fs.readFileSync(path.join(root, "src/tools/webSearch.ts"), "utf8");
  webSearch = replaceExact(webSearch, WEB_SEARCH_INTERFACE, WEB_SEARCH_INTERFACE_WITH_ERROR, "web-search-error");
  webSearch = replaceExact(webSearch, WEB_SEARCH_GUARD_BEFORE, WEB_SEARCH_GUARD_AFTER, "web-search-guard");
  fs.writeFileSync(path.join(root, "src/tools/webSearch.ts"), webSearch, { encoding: "utf8", mode: 0o644 });
  let monitorTest = fs.readFileSync(path.join(root, "test/monitor.test.ts"), "utf8");
  monitorTest = replaceExact(monitorTest, MONITOR_TEST_IMPORT_BEFORE, MONITOR_TEST_IMPORT_AFTER, "monitor-test-import");
  monitorTest = replaceExact(monitorTest, MONITOR_TEST_ANCHOR, `${MONITOR_TEST_ANCHOR}${MONITOR_TESTS}`, "monitor-tests");
  fs.writeFileSync(path.join(root, "test/monitor.test.ts"), monitorTest, { encoding: "utf8", mode: 0o644 });
  fs.writeFileSync(path.join(root, "test/webSearch.test.ts"), WEB_SEARCH_TEST, { encoding: "utf8", mode: 0o644, flag: "wx" });
  for (const [relative, hashes] of Object.entries(EXPECTED)) verifyFile(root, relative, hashes.after);
  return Object.freeze({ operation: "apply_ai_radar_search10", changedFiles: structuredClone(AI_RADAR_SEARCH10_ALLOWED_CHANGES), postImageDigests: Object.fromEntries(Object.entries(EXPECTED).map(([file, value]) => [file, value.after])) });
}

const checkCache = new Map();
const OFFLINE_CHECK_PROFILE = "(version 1) (allow default) (deny network*) (allow network* (local unix-socket))";
function run(command, args, root, env) {
  const result = spawnSync("/usr/bin/sandbox-exec", ["-p", OFFLINE_CHECK_PROFILE, command, ...args], { cwd: root, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { command: [command, ...args].join(" "), status: result.status, stdoutDigest: digest(result.stdout ?? ""), stderrDigest: digest(result.stderr ?? ""), output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
function repositoryChecks(root, candidateCommit) {
  if (checkCache.has(candidateCommit)) return checkCache.get(candidateCommit);
  const dependencyRoot = path.join(AI_RADAR_PROTECTED_ROOT, "node_modules");
  if (!fs.lstatSync(dependencyRoot).isDirectory()) throw new Error("AI_RADAR_SEARCH10_INSTALLED_DEPENDENCIES_REQUIRED");
  const link = path.join(root, "node_modules");
  if (fs.existsSync(link)) throw new Error("AI_RADAR_SEARCH10_DEPENDENCY_PATH_OCCUPIED");
  const scratch = fs.mkdtempSync("/private/tmp/ai-radar-search10-check-");
  fs.symlinkSync(dependencyRoot, link, "dir");
  try {
    const env = { PATH: `${path.join(dependencyRoot, ".bin")}:/usr/local/bin:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch, NODE_PATH: dependencyRoot, npm_config_cache: path.join(scratch, "npm-cache"), npm_config_update_notifier: "false", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false", GIT_SSH_COMMAND: "/usr/bin/false", GIT_NO_LAZY_FETCH: "1" };
    const network = run("/usr/bin/python3", ["-B", "-c", "import ctypes,os;lib=ctypes.CDLL('/usr/lib/libsandbox.dylib');f=lib.sandbox_check;f.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int];f.restype=ctypes.c_int;print(f(os.getpid(),b'network-outbound',0),f(os.getpid(),b'network-inbound',0))"], root, env);
    const checks = [run("/usr/local/bin/npm", ["run", "build"], root, env), run("/usr/local/bin/npm", ["test"], root, env), run(path.join(link, ".bin/tsc"), ["-p", "tsconfig.worker.json"], root, env)];
    if (network.status !== 0 || network.output.trim() !== "1 1" || checks.some((item) => item.status !== 0)) throw new Error(`AI_RADAR_SEARCH10_OFFLINE_CHECK_FAILED:${JSON.stringify({ network, checks })}`);
    const value = Object.freeze({ mechanism: "MACOS_SANDBOX_EXEC", networkInbound: "DENIED", networkOutbound: "DENIED", checks: checks.map(({ command, status, stdoutDigest, stderrDigest, output }) => ({ command, status, stdoutDigest, stderrDigest, tests: output.match(/(?:ℹ|#) tests (\d+)/u)?.[1] ?? null, passed: output.match(/(?:ℹ|#) pass (\d+)/u)?.[1] ?? null, failed: output.match(/(?:ℹ|#) fail (\d+)/u)?.[1] ?? null })) });
    checkCache.set(candidateCommit, value); return value;
  } finally {
    fs.rmSync(link, { force: true }); fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export function inspectAiRadarSearch10Candidate(root, baselineCommit, candidateCommit) {
  if (baselineCommit !== AI_RADAR_SEARCH10_BASELINE) throw new Error("AI_RADAR_SEARCH10_BASELINE_MISMATCH");
  const metadata = commitMetadata(root, candidateCommit);
  if (metadata.parents.length !== 1 || metadata.parents[0] !== baselineCommit) throw new Error("AI_RADAR_SEARCH10_CANDIDATE_PARENT_MISMATCH");
  const cumulative = changedFiles(root, baselineCommit, candidateCommit);
  const expectedChanges = AI_RADAR_SEARCH10_ALLOWED_CHANGES.map((item) => ({ path: item.path, status: item.operation === "ADD" ? "A" : "M", oldMode: item.operation === "ADD" ? "000000" : "100644", newMode: "100644" }));
  if (cumulative.length !== expectedChanges.length || expectedChanges.some((expected, index) => Object.entries(expected).some(([key, value]) => cumulative[index]?.[key] !== value))) throw new Error("AI_RADAR_SEARCH10_CUMULATIVE_SCOPE_MISMATCH");
  const objects = cumulative.map((change) => {
    const raw = inspectGit(root, ["ls-tree", "-z", candidateCommit, "--", change.path]).stdout.toString("utf8");
    const match = raw.match(/^(\d{6}) (\S+) ([0-9a-f]{40})\t([^\0]+)\0$/u);
    if (!match || match[1] !== "100644" || match[2] !== "blob" || match[4] !== change.path || match[3] !== change.newObject) throw new Error("AI_RADAR_SEARCH10_OBJECT_MISMATCH");
    const bytes = inspectGit(root, ["cat-file", "blob", match[3]]).stdout; const sha256 = digest(bytes);
    if (sha256 !== EXPECTED[change.path].after) throw new Error(`AI_RADAR_SEARCH10_POST_IMAGE_MISMATCH:${change.path}`);
    return Object.freeze({ path: change.path, objectId: match[3], sha256, mode: match[1], operation: change.status === "A" ? "ADD" : "MODIFY" });
  });
  const checks = repositoryChecks(root, candidateCommit);
  const outcomes = Object.freeze(Object.fromEntries(AI_RADAR_SEARCH10_VALIDATIONS.map((item) => [item.id, true])));
  return Object.freeze({ metadata, cumulative, objects: Object.freeze(objects), checks, outcomes, detailsDigest: sha256Canonical({ cumulative, objects, checks, outcomes }) });
}
