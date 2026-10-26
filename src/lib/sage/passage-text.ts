/** Remove parser-generated page separators without discarding source prose. */
export function cleanPassageText(text: string): string {
  const cleaned = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/i.test(line))
    .join("\n")
    .trim();

  // Scanned forms can expose only their interactive button labels. Those
  // labels alone are not evidence and must not become semantic passages.
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.some((line) => !/^(?:print|reset|clear form|submit)$/i.test(line))
    ? cleaned
    : "";
}
