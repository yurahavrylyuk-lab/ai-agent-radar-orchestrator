import { git, remotes, resolveCommit } from "./git-evidence.mjs";

export const APPROVED_CONTROLLER_ORIGIN = "https://github.com/yurahavrylyuk-lab/ai-agent-radar-orchestrator.git";

function lines(value) {
  return value.trim().split("\n").filter(Boolean);
}

function assertSafeUrl(value) {
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/iu.test(value) || /(?:token|password|oauth|pat)[=:]/iu.test(value)) {
    throw new Error("CREDENTIAL_BEARING_CONTROLLER_REMOTE");
  }
}

export function verifyControllerRemotePolicy(root, { expectedCommit = null, requirePublished = true } = {}) {
  if (remotes(root).join("\n") !== "origin") throw new Error("CONTROLLER_REMOTE_POLICY_VIOLATION");
  const fetchUrls = lines(git(root, ["remote", "get-url", "--all", "origin"]).stdout);
  const pushUrls = lines(git(root, ["remote", "get-url", "--push", "--all", "origin"]).stdout);
  if (fetchUrls.length !== 1 || pushUrls.length !== 1 || fetchUrls[0] !== APPROVED_CONTROLLER_ORIGIN || pushUrls[0] !== APPROVED_CONTROLLER_ORIGIN) {
    throw new Error("CONTROLLER_REMOTE_IDENTITY_MISMATCH");
  }
  assertSafeUrl(fetchUrls[0]);
  assertSafeUrl(pushUrls[0]);
  const rewrites = git(root, ["config", "--show-origin", "--get-regexp", "^url\\..*\\.(insteadOf|pushInsteadOf)$"], { allowFailure: true });
  if (rewrites.status === 0 && rewrites.stdout.trim() !== "") throw new Error("CONTROLLER_REMOTE_URL_REWRITE_PRESENT");
  const branch = git(root, ["branch", "--show-current"]).stdout.trim();
  const upstream = git(root, ["rev-parse", "--abbrev-ref", "@{upstream}"], { allowFailure: true });
  if (branch !== "main" || upstream.status !== 0 || upstream.stdout.trim() !== "origin/main") throw new Error("CONTROLLER_MAIN_UPSTREAM_MISMATCH");
  const head = resolveCommit(root);
  const remoteTip = resolveCommit(root, "refs/remotes/origin/main");
  if (expectedCommit !== null && head !== expectedCommit) throw new Error("CONTROLLER_COMMIT_MISMATCH");
  if (requirePublished && head !== remoteTip) throw new Error("CONTROLLER_RELEASE_NOT_PUBLISHED");
  const linear = git(root, ["merge-base", "--is-ancestor", remoteTip, head], { allowFailure: true });
  if (linear.status !== 0) throw new Error("CONTROLLER_HISTORY_NOT_LINEAR");
  return Object.freeze({ branch, upstream: "origin/main", fetchUrl: fetchUrls[0], pushUrl: pushUrls[0], head, remoteTip });
}
