import { sha256Bytes } from "./contracts.mjs";

export const OFFLINE_FIXTURE_TEMPLATE_VERSION = "offline-fixture-guide-r1";
export const OFFLINE_FIXTURE_GOOD_CONTENT = `# Reading a Fictional Offline Fixture\n\nThis fictional, offline lesson explains how to inspect a small sample record without contacting any service. Read the title, identify the fields, compare the expected and observed values, and write down what the evidence supports.\n\nThe exercise is educational: it teaches careful observation, explicit assumptions, and repeatable local checks. The example does not describe a real system or an operational procedure.\n`;
export const OFFLINE_FIXTURE_DEFECT_CONTENT = `# Reading a Fictional Offline Fixture\n\nThis fictional, offline example is intentionally incomplete. It asks the learner to observe a sample but omits the required teaching explanation.\n`;
export const OFFLINE_FIXTURE_GOOD_DIGEST = sha256Bytes(Buffer.from(OFFLINE_FIXTURE_GOOD_CONTENT, "utf8"));

export function validateOfflineFixtureTemplate(content) {
  if (typeof content !== "string" || content.includes("\0")) return false;
  const words = content.trim().split(/\s+/u).filter(Boolean).length;
  return words <= 800 && sha256Bytes(Buffer.from(content, "utf8")) === OFFLINE_FIXTURE_GOOD_DIGEST;
}
