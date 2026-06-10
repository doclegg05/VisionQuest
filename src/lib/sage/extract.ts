import fs from "fs/promises";
import path from "path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { logger } from "@/lib/logger";

const SSN_PATTERN = /\d{3}-\d{2}-\d{4}/;
const CASE_NUMBER_PATTERN = /\b(case|tanf|wv\s*works)\b.*?\b\d{7,10}\b/i;

export interface ExtractionResult {
  text: string;
  pageCount?: number;
}

export interface ExtractOptions {
  /** Cap on returned characters. Default 4000 (summary-sized). */
  maxChars?: number;
  /** PDF only: number of leading pages to parse. Default 3. */
  maxPages?: number;
}

const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_PAGES = 3;

/**
 * Extract readable text from an in-memory file body. Works for both local
 * files and storage downloads (Supabase/R2 buffers). Returns null if
 * extraction fails or the type is unsupported (images, etc.).
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  ext: string,
  options: ExtractOptions = {},
): Promise<ExtractionResult | null> {
  const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  try {
    if (buffer.length === 0) return null;

    switch (normalizedExt) {
      case ".pdf": {
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const result = await parser.getText({ first: maxPages });
        const text = result.text?.trim();
        if (!text) return null;
        return { text: text.slice(0, maxChars), pageCount: result.total };
      }
      case ".docx": {
        const result = await mammoth.extractRawText({ buffer });
        const text = result.value?.trim();
        if (!text) return null;
        return { text: text.slice(0, maxChars) };
      }
      case ".txt":
      case ".md":
        return { text: buffer.toString("utf-8").slice(0, maxChars) };
      default:
        return null; // Unsupported (images, etc.)
    }
  } catch (error) {
    logger.error(`Extraction failed for buffer (${normalizedExt})`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Extract readable text from a file. Returns null if extraction fails
 * or the file type is unsupported (images, etc.).
 */
export async function extractText(
  filePath: string
): Promise<ExtractionResult | null> {
  const ext = path.extname(filePath).toLowerCase();

  try {
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      logger.warn(`Skipped empty file: ${filePath}`);
      return null;
    }

    const buffer = await fs.readFile(filePath);
    // txt/md historically returned the full file; pdf/docx cap at 4000 chars.
    const maxChars =
      ext === ".txt" || ext === ".md" ? Number.POSITIVE_INFINITY : DEFAULT_MAX_CHARS;
    return await extractTextFromBuffer(buffer, ext, { maxChars });
  } catch (error) {
    logger.error(`Extraction failed for ${filePath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Lightweight regex-based PII scan. Returns true if PII patterns are detected.
 * Does NOT match student names (too many false positives in form templates).
 */
export function containsPII(text: string): boolean {
  return SSN_PATTERN.test(text) || CASE_NUMBER_PATTERN.test(text);
}
