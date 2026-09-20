import assert from "node:assert/strict";
import test from "node:test";
import { applyRetention } from "../src/retention.mjs";

test("31 retention removes only expired disposable records", () => {
  const records = [{ id: "audit", retention: "AUDIT", expiresAt: "2020-01-01T00:00:00Z" }, { id: "expired", retention: "DISPOSABLE", expiresAt: "2020-01-01T00:00:00Z" }, { id: "future", retention: "DISPOSABLE", expiresAt: "2030-01-01T00:00:00Z" }]; assert.deepEqual(applyRetention(records, Date.parse("2026-01-01T00:00:00Z")).map((item) => item.id), ["audit", "future"]);
});
