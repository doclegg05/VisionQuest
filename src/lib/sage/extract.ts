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

    switch (ext) {
      case ".pdf":
        return await extractPdf(filePath);
      case ".docx":
        return await extractDocx(filePath);
      case ".txt":
      case ".md":
        return { text: await fs.readFile(filePath, "utf-8") };
      default:
        return null; // Unsupported (images, etc.)
    }
  } catch (error) {
    logger.error(`Extraction failed for ${filePath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function extractPdf(filePath: string): Promise<ExtractionResult | null> {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText({ first: 3 }); // First 3 pages
  const text = result.text?.trim();
  if (!text) return null;
  return { text: text.slice(0, 4000), pageCount: result.total };
}

async function extractDocx(filePath: string): Promise<ExtractionResult | null> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value?.trim();
  if (!text) return null;
  return { text: text.slice(0, 4000) };
}

/**
 * Lightweight regex-based PII scan. Returns true if PII patterns are detected.
 * Does NOT match student names (too many false positives in form templates).
 */
export function containsPII(text: string): boolean {
  return SSN_PATTERN.test(text) || CASE_NUMBER_PATTERN.test(text);
}
