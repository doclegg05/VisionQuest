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
