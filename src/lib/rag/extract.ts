// src/lib/rag/extract.ts

import fs from "node:fs/promises";
import path from "node:path";
import type { ExtractedDocument, ExtractedPage } from "./types";
import { logger } from "@/lib/logger";

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/markdown",
  "text/plain",
]);

const LOW_QUALITY_THRESHOLD = 0.3;

/**
 * Compute a quality score (0.0 to 1.0) for a page of extracted text.
 *
 * Factors:
 *  - Text density: very short text for a "page" scores low
 *  - Printable character ratio: high ratio of non-printable/replacement chars scores low
 *  - Whitespace ratio: >80% whitespace scores low
 */
export function scorePageQuality(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  // Text density: pages with < 50 chars are suspicious
  const densityScore = Math.min(text.length / 50, 1.0);

  // Printable character ratio — count non-printable and Unicode replacement chars
  let nonPrintable = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Allow tabs (9), newlines (10, 13), and printable ASCII (32+)
    // Also allow standard Unicode above 127, but flag replacement char U+FFFD
    if (code === 0xfffd) {
      nonPrintable++;
    } else if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      nonPrintable++;
    }
  }
  const printableRatio =
    text.length > 0 ? 1 - nonPrintable / text.length : 0;

  // Whitespace ratio — penalize heavily when >80% whitespace
  const whitespaceCount = (text.match(/\s/g) || []).length;
  const whitespaceRatio = whitespaceCount / text.length;
  const whitespaceScore = whitespaceRatio > 0.8 ? 0 : 1.0;

  // Multiplicative: any single bad signal drags the overall score down
  const score = densityScore * printableRatio * whitespaceScore;

  return Math.max(0, Math.min(1, score));
}

/**
 * Extract text from a file on disk.
 * Dispatches to the appropriate extractor based on mimeType.
 */
export async function extractFromFile(
  filePath: string,
  mimeType: string,
): Promise<ExtractedDocument> {
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported mimeType for extraction: ${mimeType}`);
  }

  const title = path.basename(filePath, path.extname(filePath));
  const buffer = await fs.readFile(filePath);

  return extractFromBuffer(buffer, mimeType, title);
}

/**
 * Extract text from a buffer.
 * Dispatches to the appropriate extractor based on mimeType.
 */
export async function extractFromBuffer(
  buffer: Buffer,
  mimeType: string,
  title: string,
): Promise<ExtractedDocument> {
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported mimeType for extraction: ${mimeType}`);
  }

  let pages: ExtractedPage[];

  switch (mimeType) {
    case "application/pdf":
      pages = await extractPdf(buffer);
      break;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      pages = await extractDocx(buffer);
      break;
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      pages = await extractXlsx(buffer);
      break;
    case "text/markdown":
    case "text/plain":
      pages = extractText(buffer);
      break;
    default:
      throw new Error(`Unsupported mimeType for extraction: ${mimeType}`);
  }

  return { pages, title, mimeType };
}

async function extractPdf(buffer: Buffer): Promise<ExtractedPage[]> {
  const { PDFParse } = await import("pdf-parse");

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const textResult = await parser.getText();

  const pages: ExtractedPage[] = textResult.pages.map((page) => {
    const qualityScore = scorePageQuality(page.text);

    if (qualityScore < LOW_QUALITY_THRESHOLD) {
      logger.warn("Low quality page detected — may need OCR", {
        pageNumber: page.num,
        qualityScore,
        textLength: page.text.length,
      });
    }

    return {
      pageNumber: page.num,
      text: page.text.trim(),
      qualityScore,
      ocrUsed: false,
    };
  });

  await parser.destroy();
  return pages;
}

async function extractDocx(buffer: Buffer): Promise<ExtractedPage[]> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value || "";

  return [
    {
      pageNumber: 1,
      text,
      qualityScore: 1.0,
      ocrUsed: false,
    },
  ];
}

async function extractXlsx(buffer: Buffer): Promise<ExtractedPage[]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const pages: ExtractedPage[] = [];

  for (let sheetIdx = 0; sheetIdx < workbook.SheetNames.length; sheetIdx++) {
    const sheetName: string = workbook.SheetNames[sheetIdx];
    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (rows.length === 0) {
      pages.push({
        pageNumber: sheetIdx + 1,
        text: `Sheet: ${sheetName}\n(empty)`,
        qualityScore: 0,
        ocrUsed: false,
      });
      continue;
    }

    // First row is headers
    const headers: string[] = (rows[0] || []).map((h: unknown) =>
      h != null ? String(h) : "",
    );

    const lines: string[] = [`Sheet: ${sheetName}`];

    for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      if (!row || row.length === 0) continue;

      const cells = headers
        .map((header, colIdx) => {
          const val = row[colIdx];
          if (val == null || val === "") return null;
          const colName = header || `col${colIdx + 1}`;
          return `${colName}=${val}`;
        })
        .filter(Boolean);

      if (cells.length > 0) {
        lines.push(`Row ${rowIdx}: ${cells.join(", ")}`);
      }
    }

    const text = lines.join("\n");
    pages.push({
      pageNumber: sheetIdx + 1,
      text,
      qualityScore: scorePageQuality(text),
      ocrUsed: false,
    });
  }

  return pages;
}

function extractText(buffer: Buffer): ExtractedPage[] {
  const text = buffer.toString("utf-8");

  return [
    {
      pageNumber: 1,
      text,
      qualityScore: 1.0,
      ocrUsed: false,
    },
  ];
}
