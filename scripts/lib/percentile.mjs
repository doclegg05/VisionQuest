/**
 * Nearest-rank percentile over a pre-sorted ascending numeric array.
 *
 * Shared by sage-load-test.mjs, sage-chat-harness.mjs, sage-rag-harness.mjs,
 * and sage-usage-summary.mjs — p is always on the 0–100 scale (95 means p95,
 * and 0.5 means the 0.5th percentile, never the median). Callers that report 0
 * for an empty dataset adapt with `?? 0`; sage-load-test keeps the null.
 *
 * @param {readonly number[]} sortedValues values sorted ascending
 * @param {number} p percentile on the 0–100 scale
 * @returns {number | null} the nearest-rank value, or null for an empty array
 */
export function percentile(sortedValues, p) {
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new RangeError(`percentile p must be on the 0-100 scale, got ${p}`);
  }
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)];
}
