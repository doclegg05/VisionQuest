/**
 * Parses raw salary text into a normalized hourly rate (float).
 *
 * Examples:
 *   "$14.50/hr" → 14.50
 *   "$30,000/year" → 14.42  (30000 / 2080)
 *   "$15-$18/hr" → 15  (take minimum)
 *   "Competitive" → null
 */

const HOURS_PER_YEAR = 2080;

export function parseSalaryToHourly(raw: string | null | undefined): number | null {
  if (!raw) return null;

  const cleaned = raw.replace(/[,\s]/g, "").toLowerCase();

  // Match dollar amounts: "$14.50", "$30000"
  const amounts = [...cleaned.matchAll(/\$?([\d.]+)/g)].map((m) => parseFloat(m[1]));
  if (amounts.length === 0 || isNaN(amounts[0])) return null;

  const minAmount = amounts[0]; // Take the minimum (first match)

  // Determine if yearly or hourly
  if (cleaned.includes("/yr") || cleaned.includes("/year") || cleaned.includes("annual")) {
    return Math.round((minAmount / HOURS_PER_YEAR) * 100) / 100;
  }

  // If amount > 1000, assume yearly even without explicit marker
  if (minAmount > 1000) {
    return Math.round((minAmount / HOURS_PER_YEAR) * 100) / 100;
  }

  // Default: assume hourly
  return Math.round(minAmount * 100) / 100;
}
