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

const WH_WORDS = new Set(["who", "what", "where", "when", "why", "how", "which"]);
const CLAUSE_SUBJECTS = new Set(["we", "you", "they", "i"]);
const SENTENCE_STARTS = new Set(["we", "they", "i", "it", "you", "this", "these", "something", "there"]);
const FINITE = new Set([
  "is", "are", "was", "were", "am", "be", "been", "can", "cannot", "could", "will", "would", "should", "must",
  "do", "does", "did", "has", "have", "had", "went", "won't", "can't", "couldn't", "didn't", "doesn't", "isn't", "aren't", "wasn't",
]);

/**
 * True for a heading that is a whole sentence (a subject with a finite verb, or one
 * that ends in a period or exclamation mark). SPOKES voice keeps those in sentence
 * case; the heading tool skips them. Wh-clauses ("Where things stand") are titles.
 */
export function isSentence(text) {
  const clean = text.replace(/&apos;|’/g, "'").trim();
  if (/[.!]$/.test(clean)) return true;
  const words = clean.toLowerCase().split(/\s+/);
  if (WH_WORDS.has(words[0])) return false;
  if (SENTENCE_STARTS.has(words[0]) && words.length > 1) return true;
  return words.some((word, i) => {
    if (i === 0) return false;
    if (FINITE.has(word)) return true;
    return CLAUSE_SUBJECTS.has(word) && i < words.length - 1;
  });
}
