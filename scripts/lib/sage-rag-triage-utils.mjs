/**
 * Shared helpers for scripts/sage-rag-triage.mjs — TSV worksheet I/O,
 * near-duplicate title hints, and the disposition marker persisted into
 * `sageContextNote` for archived/exempt documents.
 *
 * Kept separate from scripts/lib/sage-rag-utils.mjs (audit/activate/notes
 * helpers) because these are triage-worksheet-specific and would otherwise
 * bloat that shared file.
 */

export const DISPOSITIONS = ["activate", "archive", "exempt"];

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "your",
  "this",
  "that",
  "into",
  "form",
  "guide",
  "document",
]);

// ── TSV read/write ──────────────────────────────────────────────────────────

/** Escape a value for a single TSV cell: strip tabs/newlines, trim. */
export function tsvEscape(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\t\r\n]+/g, " ").trim();
}

/** Serialize rows (array of plain objects) to TSV text using `columns` as the header/order. */
export function writeTsv(columns, rows) {
  const lines = [columns.join("\t")];
  for (const row of rows) {
    lines.push(columns.map((col) => tsvEscape(row[col])).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Parse TSV text into { columns, rows }. Rows are plain objects keyed by
 * header name. Blank lines are skipped. Throws if the file has no header
 * or is otherwise structurally empty.
 */
export function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error("TSV file is empty");
  }
  const columns = lines[0].split("\t");
  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split("\t");
    const row = {};
    columns.forEach((col, i) => {
      row[col] = cells[i] ?? "";
    });
    row.__line = index + 2; // 1-indexed + header row
    return row;
  });
  return { columns, rows };
}

// ── Title similarity (near-duplicate hint) ──────────────────────────────────

/** Lowercase, strip punctuation, drop short/stop tokens — a bag-of-words set. */
export function titleTokens(title) {
  const words = (title || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
}

/** Jaccard similarity between two token sets, 0..1. */
export function jaccardSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Best-matching active title for `title`, or null below `threshold`.
 * `activeTitleTokens` is an array of { title, tokens } pre-computed once
 * per worksheet run (avoid re-tokenizing the active set per candidate).
 */
export function bestNearDuplicate(title, activeTitleTokens, threshold = 0.4) {
  const tokens = titleTokens(title);
  let best = null;
  for (const candidate of activeTitleTokens) {
    const score = jaccardSimilarity(tokens, candidate.tokens);
    if (score >= threshold && (!best || score > best.score)) {
      best = { title: candidate.title, score };
    }
  }
  return best;
}

/**
 * Sort key that clusters similar/reordered titles together: lowercase,
 * meaningful tokens (len>=3), sorted alphabetically, joined. E.g. "Study
 * Guide IC3" and "IC3 Study Guide" both sort under "guide ic3 study".
 */
export function normalizedTitleSortKey(title) {
  return [...titleTokens(title)].sort().join(" ");
}

// ── Disposition marker (archive/exempt persisted in sageContextNote) ───────

const MARKER_PREFIX = "[SAGE-RAG-TRIAGE:";
const MARKER_RE = /^\[SAGE-RAG-TRIAGE:(ARCHIVE|EXEMPT)\s+(\d{4}-\d{2}-\d{2})\]\s*(.*)$/s;

/** Build the single-line marker written to sageContextNote for archive/exempt rows. */
export function buildTriageNote(disposition, reason, date = new Date()) {
  const tag = disposition.toUpperCase();
  const day = date.toISOString().slice(0, 10);
  const cleanReason = tsvEscape(reason) || "(no reason given)";
  return `${MARKER_PREFIX}${tag} ${day}] ${cleanReason}`;
}

/**
 * Parse a previously-written marker back out of a sageContextNote value.
 * Returns { disposition, date, reason } or null if the note isn't a
 * triage marker (i.e. it's a real grounding note, or empty).
 */
export function parseTriageNote(note) {
  if (!note) return null;
  const match = MARKER_RE.exec(note.trim());
  if (!match) return null;
  return {
    disposition: match[1].toLowerCase(),
    date: match[2],
    reason: match[3],
  };
}
