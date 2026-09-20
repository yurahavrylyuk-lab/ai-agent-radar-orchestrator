export function applyRetention(records, nowMs) {
  return records.filter((record) => record.retention === "AUDIT" || record.expiresAt === null || Date.parse(record.expiresAt) > nowMs).map((value) => structuredClone(value));
}
