/**
 * Boundary-aware text chunking for document embeddings (Phase 1 semantic RAG).
 *
 * Targets ~512-token chunks (≈2048 chars at ~4 chars/token) with ~50-token
 * (≈200-char) overlap so retrieval context survives chunk boundaries.
 * Splits prefer paragraph breaks, then sentence ends, then hard cuts.
 */

export interface ChunkOptions {
  /** Maximum characters per chunk. Default 2048 (≈512 tokens). */
  maxChars?: number;
  /** Characters of trailing context carried into the next chunk. Default 200. */
  overlapChars?: number;
}

const DEFAULT_MAX_CHARS = 2048;
const DEFAULT_OVERLAP_CHARS = 200;

/** Split text into paragraph-sized segments, falling back to sentences. */
function splitIntoSegments(text: string, maxChars: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const segments: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      segments.push(paragraph);
      continue;
    }
    // Paragraph too large — split on sentence boundaries.
    const sentences = paragraph.match(/[^.!?\n]+[.!?]*\s*/g) ?? [paragraph];
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length <= maxChars) {
        segments.push(trimmed);
        continue;
      }
      // Sentence still too large — hard cut.
      for (let i = 0; i < trimmed.length; i += maxChars) {
        segments.push(trimmed.slice(i, i + maxChars));
      }
    }
  }
  return segments;
}

/**
 * Chunk text for embedding. Returns [] for blank input, a single chunk for
 * short text. No chunk exceeds maxChars; consecutive chunks share up to
 * overlapChars of trailing context from the previous chunk.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = Math.min(
    options.overlapChars ?? DEFAULT_OVERLAP_CHARS,
    Math.floor(maxChars / 2),
  );

  const normalized = text.trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= maxChars) return [normalized];

  const segments = splitIntoSegments(normalized, maxChars);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
  };

  for (const segment of segments) {
    const joiner = current.length > 0 ? "\n" : "";
    if (current.length + joiner.length + segment.length <= maxChars) {
      current = `${current}${joiner}${segment}`;
      continue;
    }

    pushCurrent();
    // Seed the next chunk with overlap from the end of the previous one,
    // but only when the segment leaves room for it.
    const overlap =
      overlapChars > 0 && current.length > 0 && segment.length + overlapChars + 1 <= maxChars
        ? current.slice(-overlapChars)
        : "";
    current = overlap.length > 0 ? `${overlap}\n${segment}` : segment;
  }
  pushCurrent();

  return chunks;
}
