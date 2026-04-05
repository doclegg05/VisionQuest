// src/lib/rag/chunker.ts

import type { ExtractedPage, ChunkData } from "./types";

const PAGE_MARKER = "\n<<PAGE_BREAK>>\n";

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

export function buildBreadcrumb(
  docTitle: string,
  sectionHeading: string | null,
): string {
  const title = docTitle.replace(/\s+/g, " ").trim();
  if (!sectionHeading) {
    return title;
  }
  const heading = sectionHeading.replace(/\s+/g, " ").trim();
  return `${title} > ${heading}`;
}

// ---------------------------------------------------------------------------
// Boilerplate stripping
// ---------------------------------------------------------------------------

const BOILERPLATE_LINE_WINDOW = 3;
const BOILERPLATE_MIN_PAGES = 3;

export function stripBoilerplate(pages: ExtractedPage[]): ExtractedPage[] {
  if (pages.length < BOILERPLATE_MIN_PAGES) {
    return pages;
  }

  // Count how many pages each leading/trailing line appears on.
  const headerLineCounts = new Map<string, number>();
  const footerLineCounts = new Map<string, number>();

  for (const page of pages) {
    const lines = page.text.split("\n");

    // Check first N lines
    const headLines = lines.slice(0, BOILERPLATE_LINE_WINDOW);
    for (const line of headLines) {
      const trimmed = line.trim();
      if (trimmed) {
        headerLineCounts.set(trimmed, (headerLineCounts.get(trimmed) ?? 0) + 1);
      }
    }

    // Check last N lines
    const tailLines = lines.slice(-BOILERPLATE_LINE_WINDOW);
    for (const line of tailLines) {
      const trimmed = line.trim();
      if (trimmed) {
        footerLineCounts.set(trimmed, (footerLineCounts.get(trimmed) ?? 0) + 1);
      }
    }
  }

  const repeatedHeaderLines = new Set<string>();
  for (const [line, count] of headerLineCounts) {
    if (count >= BOILERPLATE_MIN_PAGES) {
      repeatedHeaderLines.add(line);
    }
  }

  const repeatedFooterLines = new Set<string>();
  for (const [line, count] of footerLineCounts) {
    if (count >= BOILERPLATE_MIN_PAGES) {
      repeatedFooterLines.add(line);
    }
  }

  if (repeatedHeaderLines.size === 0 && repeatedFooterLines.size === 0) {
    return pages;
  }

  return pages.map((page) => {
    const lines = page.text.split("\n");

    // Remove leading boilerplate lines
    while (lines.length > 0) {
      const trimmed = lines[0].trim();
      if (trimmed && repeatedHeaderLines.has(trimmed)) {
        lines.shift();
      } else {
        break;
      }
    }

    // Remove trailing boilerplate lines
    while (lines.length > 0) {
      const trimmed = lines[lines.length - 1].trim();
      if (trimmed && repeatedFooterLines.has(trimmed)) {
        lines.pop();
      } else {
        break;
      }
    }

    return { ...page, text: lines.join("\n").trim() };
  });
}

// ---------------------------------------------------------------------------
// Content type detection
// ---------------------------------------------------------------------------

const URL_PATTERN = /https?:\/\/[^\s)]+/g;
const HEADING_PATTERN = /^#{1,3}\s+.+/gm;
const NUMBERED_LIST_PATTERN = /^\s*\d+[\.\)]\s+/gm;
const FORM_FIELD_PATTERN = /\w+:\s*_{2,}/g;
const CHECKBOX_PATTERN = /^\s*[-*]\s*\[[ x]\]/gim;

export function detectContentType(
  text: string,
): "structured" | "prose" | "links" {
  const urlMatches = text.match(URL_PATTERN);
  if (urlMatches && urlMatches.length >= 3) {
    return "links";
  }

  const headingMatches = text.match(HEADING_PATTERN);
  if (headingMatches && headingMatches.length >= 3) {
    return "structured";
  }

  const numberedMatches = text.match(NUMBERED_LIST_PATTERN);
  if (numberedMatches && numberedMatches.length >= 3) {
    return "structured";
  }

  const formMatches = text.match(FORM_FIELD_PATTERN);
  if (formMatches && formMatches.length >= 1) {
    return "structured";
  }

  const checkboxMatches = text.match(CHECKBOX_PATTERN);
  if (checkboxMatches && checkboxMatches.length >= 1) {
    return "structured";
  }

  return "prose";
}

// ---------------------------------------------------------------------------
// Sentence splitting helper
// ---------------------------------------------------------------------------

function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or newline,
  // and also on paragraph breaks (double newline).
  const parts = text.split(/(?<=[.!?])\s+|\n{2,}/);
  return parts.filter((s) => s.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Structured chunking
// ---------------------------------------------------------------------------

const STRUCTURED_HEADING_PATTERN =
  /^(?:#{1,3}\s+.+|\*\*.+\*\*$|\d+[\.\)]\s+.+)/gm;

const TABLE_PATTERN = /(?:^\|.+\|$\n?){2,}/gm;
const FORM_SECTION_PATTERN =
  /(?:^.*:\s*_{2,}.*$\n?){2,}/gm;
const CHECKLIST_PATTERN = /(?:^\s*[-*]\s*\[[ x]\].*$\n?){2,}/gim;

interface StructuredSection {
  heading: string | null;
  content: string;
  chunkType: string | null;
}

function detectAtomicType(content: string): string | null {
  if (TABLE_PATTERN.test(content)) {
    TABLE_PATTERN.lastIndex = 0;
    return "table";
  }
  if (FORM_SECTION_PATTERN.test(content)) {
    FORM_SECTION_PATTERN.lastIndex = 0;
    return "form";
  }
  if (CHECKLIST_PATTERN.test(content)) {
    CHECKLIST_PATTERN.lastIndex = 0;
    return "checklist";
  }
  return null;
}

function splitStructuredSections(text: string): StructuredSection[] {
  const sections: StructuredSection[] = [];
  const lines = text.split("\n");
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const isHeading =
      /^#{1,3}\s+.+/.test(line) ||
      /^\*\*.+\*\*$/.test(line) ||
      /^\d+[\.\)]\s+\S/.test(line);

    if (isHeading && currentLines.length > 0) {
      const content = currentLines.join("\n").trim();
      if (content) {
        sections.push({
          heading: currentHeading,
          content,
          chunkType: detectAtomicType(content),
        });
      }
      currentHeading = line.replace(/^#{1,3}\s+/, "").replace(/^\*\*|\*\*$/g, "").trim();
      currentLines = [line];
    } else if (isHeading) {
      currentHeading = line.replace(/^#{1,3}\s+/, "").replace(/^\*\*|\*\*$/g, "").trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content) {
      sections.push({
        heading: currentHeading,
        content,
        chunkType: detectAtomicType(content),
      });
    }
  }

  return sections;
}

function splitAtSentenceBoundaries(
  text: string,
  maxTokens: number,
): string[] {
  const sentences = splitSentences(text);
  const result: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    if (current.length > 0 && currentTokens + sentenceTokens > maxTokens) {
      result.push(current.join(" "));
      current = [];
      currentTokens = 0;
    }

    current.push(sentence);
    currentTokens += sentenceTokens;
  }

  if (current.length > 0) {
    result.push(current.join(" "));
  }

  return result;
}

const STRUCTURED_MAX_TOKENS = 300;

export function chunkStructured(
  text: string,
  docTitle: string,
): ChunkData[] {
  const sections = splitStructuredSections(text);
  const chunks: ChunkData[] = [];

  for (const section of sections) {
    const tokens = estimateTokens(section.content);

    if (tokens <= STRUCTURED_MAX_TOKENS || section.chunkType !== null) {
      // Atomic unit or within size limit — keep as one chunk
      chunks.push({
        content: section.content,
        breadcrumb: buildBreadcrumb(docTitle, section.heading),
        sectionHeading: section.heading,
        pageNumber: null,
        charStart: null,
        charEnd: null,
        chunkType: section.chunkType ?? "structured",
        tokenCount: tokens,
        ocrUsed: false,
        parentIndex: null,
      });
    } else {
      // Oversized section — split at sentence boundaries
      const subChunks = splitAtSentenceBoundaries(
        section.content,
        STRUCTURED_MAX_TOKENS,
      );
      for (const sub of subChunks) {
        const subTokens = estimateTokens(sub);
        chunks.push({
          content: sub,
          breadcrumb: buildBreadcrumb(docTitle, section.heading),
          sectionHeading: section.heading,
          pageNumber: null,
          charStart: null,
          charEnd: null,
          chunkType: "structured",
          tokenCount: subTokens,
          ocrUsed: false,
          parentIndex: null,
        });
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Prose chunking
// ---------------------------------------------------------------------------

const PROSE_TARGET_TOKENS = 325; // middle of 250-400
const PROSE_MAX_TOKENS = 400;
const PROSE_OVERLAP_TOKENS = 50;

export function chunkProse(text: string, docTitle: string): ChunkData[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return [];
  }

  const chunks: ChunkData[] = [];
  let startIdx = 0;

  while (startIdx < sentences.length) {
    let currentTokens = 0;
    let endIdx = startIdx;

    // Build chunk up to target size
    while (endIdx < sentences.length) {
      const sentenceTokens = estimateTokens(sentences[endIdx]);
      if (
        currentTokens + sentenceTokens > PROSE_MAX_TOKENS &&
        endIdx > startIdx
      ) {
        break;
      }
      currentTokens += sentenceTokens;
      endIdx++;

      if (currentTokens >= PROSE_TARGET_TOKENS) {
        break;
      }
    }

    const chunkContent = sentences.slice(startIdx, endIdx).join(" ");
    const tokenCount = estimateTokens(chunkContent);

    chunks.push({
      content: chunkContent,
      breadcrumb: buildBreadcrumb(docTitle, null),
      sectionHeading: null,
      pageNumber: null,
      charStart: null,
      charEnd: null,
      chunkType: "prose",
      tokenCount,
      ocrUsed: false,
      parentIndex: null,
    });

    // Advance with overlap: backtrack ~50 tokens worth of sentences
    let overlapTokens = 0;
    let overlapStart = endIdx;
    while (overlapStart > startIdx) {
      const prevTokens = estimateTokens(sentences[overlapStart - 1]);
      if (overlapTokens + prevTokens > PROSE_OVERLAP_TOKENS) {
        break;
      }
      overlapTokens += prevTokens;
      overlapStart--;
    }

    // Ensure we always advance at least one sentence
    const nextStart = Math.max(startIdx + 1, overlapStart);
    if (nextStart >= sentences.length) {
      break;
    }
    startIdx = nextStart;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Links chunking
// ---------------------------------------------------------------------------

export function chunkLinks(text: string, docTitle: string): ChunkData[] {
  const chunks: ChunkData[] = [];
  const urlRegex = /https?:\/\/[^\s)]+/g;
  let match: RegExpExecArray | null;
  const lines = text.split("\n");

  // For each line containing a URL, capture the line as context
  const processedUrls = new Set<string>();

  for (const line of lines) {
    urlRegex.lastIndex = 0;
    match = urlRegex.exec(line);
    if (match && !processedUrls.has(match[0])) {
      processedUrls.add(match[0]);
      const content = line.trim();
      const tokenCount = estimateTokens(content);

      chunks.push({
        content,
        breadcrumb: buildBreadcrumb(docTitle, null),
        sectionHeading: null,
        pageNumber: null,
        charStart: null,
        charEnd: null,
        chunkType: "link",
        tokenCount,
        ocrUsed: false,
        parentIndex: null,
      });
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Page boundary tracking
// ---------------------------------------------------------------------------

interface PageRange {
  pageNumber: number;
  charStart: number;
  charEnd: number;
  ocrUsed: boolean;
}

function buildPageRanges(
  pages: ExtractedPage[],
  mergedText: string,
): PageRange[] {
  const ranges: PageRange[] = [];
  let offset = 0;

  for (const page of pages) {
    const start = mergedText.indexOf(page.text, offset);
    if (start === -1) {
      continue;
    }
    ranges.push({
      pageNumber: page.pageNumber,
      charStart: start,
      charEnd: start + page.text.length,
      ocrUsed: page.ocrUsed,
    });
    offset = start + page.text.length;
  }

  return ranges;
}

function assignPageInfo(
  chunks: ChunkData[],
  mergedText: string,
  pageRanges: PageRange[],
): ChunkData[] {
  let searchOffset = 0;

  return chunks.map((chunk) => {
    const idx = mergedText.indexOf(chunk.content, searchOffset);
    if (idx === -1) {
      return chunk;
    }

    const charStart = idx;
    const charEnd = idx + chunk.content.length;
    searchOffset = idx;

    // Find which page this chunk starts in
    const pageRange = pageRanges.find(
      (r) => charStart >= r.charStart && charStart < r.charEnd,
    );

    return {
      ...chunk,
      charStart,
      charEnd,
      pageNumber: pageRange?.pageNumber ?? null,
      ocrUsed: pageRange?.ocrUsed ?? false,
    };
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function chunkDocument(
  pages: ExtractedPage[],
  docTitle: string,
): ChunkData[] {
  if (pages.length === 0) {
    return [];
  }

  // 1. Strip boilerplate
  const cleanPages = stripBoilerplate(pages);

  // 2. Merge page texts into one string
  const mergedText = cleanPages.map((p) => p.text).join(PAGE_MARKER);
  const pageRanges = buildPageRanges(cleanPages, mergedText);

  // Remove page markers for content processing
  const processText = mergedText.replaceAll(PAGE_MARKER, "\n\n");

  // 3. Detect content type
  const contentType = detectContentType(processText);

  // 4. Route to chunking strategy
  let chunks: ChunkData[];
  switch (contentType) {
    case "structured":
      chunks = chunkStructured(processText, docTitle);
      break;
    case "links":
      chunks = chunkLinks(processText, docTitle);
      break;
    case "prose":
    default:
      chunks = chunkProse(processText, docTitle);
      break;
  }

  // 5. Assign page numbers and char positions
  chunks = assignPageInfo(chunks, processText, pageRanges);

  return chunks;
}
