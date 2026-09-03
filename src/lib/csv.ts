/**
 * The only CSV cell escaper in the codebase. Every CSV export path must run
 * each cell through it: it neutralizes spreadsheet formula triggers
 * (`=`, `+`, `-`, `@`, tab, CR) by prefixing a quote, then applies RFC 4180
 * quoting for commas, double quotes, and line breaks.
 *
 * Callers own the unknown-to-string step (null, arrays, dates) so that this
 * signature stays narrow and a nullable field cannot slip past the type check.
 */
export function escapeCsvValue(value: string | number | boolean): string {
  let text = String(value);

  if (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}
