/**
 * Title Case for page titles and card headings (SPOKES content fundamentals).
 * Small words stay lowercase unless first or last; a word that already holds a
 * capital (SPOKES, IC3, Sage) is left as written.
 */
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "per", "the", "to", "up", "via", "vs", "with"]);

const capitalize = (part) => (/[A-Z]/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1));

function caseWord(word, isEdge) {
  if (!isEdge && SMALL.has(word.toLowerCase())) return word.toLowerCase();
  return word.split("-").map(capitalize).join("-");
}

export function titleCase(text) {
  const parts = text.split(/(\s+)/);
  const wordIndexes = parts.map((part, i) => (part.trim() ? i : -1)).filter((i) => i >= 0);
  const first = wordIndexes[0];
  const last = wordIndexes.at(-1);
  return parts.map((part, i) => (part.trim() ? caseWord(part, i === first || i === last) : part)).join("");
}
