/**
 * Coerce any cell value (null/undefined → "", arrays → "; "-joined) and
 * escape it through the formula-safe escaper. Every CSV export path must use
 * this or escapeCsvValue directly — never a local escaper without the
 * formula-prefix neutralization (VQ-R-014).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  return escapeCsvValue(text);
}

export function escapeCsvValue(value: string | number | boolean): string {
  let text = String(value);

  if (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}
