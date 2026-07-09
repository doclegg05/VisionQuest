import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getSession } from "@/lib/auth";
import { downloadFile } from "@/lib/storage";
import { getOrientationPacket } from "@/lib/spokes/orientation-packet";
import type { SpokesForm } from "@/lib/spokes/forms";

// Merging PDFs is CPU-bound and reads binary buffers from storage — must run on
// the Node runtime, never the edge, and never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// US Letter, points.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const LINE_HEIGHT = 20;

interface MergeResult {
  form: SpokesForm;
  doc: PDFDocument | null;
  pageCount: number;
  error: string | null;
}

function isPdf(storageKey: string, mimeType: string): boolean {
  return mimeType.includes("pdf") || storageKey.toLowerCase().endsWith(".pdf");
}

/** Fetch + parse each printable form. Failures are recorded, never thrown. */
async function loadPrintableForms(forms: SpokesForm[]): Promise<MergeResult[]> {
  const results: MergeResult[] = [];
  for (const form of forms) {
    if (!form.storageKey) {
      results.push({ form, doc: null, pageCount: 0, error: "No PDF on file" });
      continue;
    }
    try {
      const file = await downloadFile(form.storageKey);
      if (!file) {
        results.push({ form, doc: null, pageCount: 0, error: "Not uploaded yet" });
        continue;
      }
      if (!isPdf(form.storageKey, file.mimeType)) {
        results.push({ form, doc: null, pageCount: 0, error: "Not a PDF file" });
        continue;
      }
      const doc = await PDFDocument.load(new Uint8Array(file.buffer), {
        ignoreEncryption: true,
      });
      results.push({ form, doc, pageCount: doc.getPageCount(), error: null });
    } catch {
      // A single corrupt/locked PDF must not sink the whole packet.
      results.push({ form, doc: null, pageCount: 0, error: "Could not read PDF" });
    }
  }
  return results;
}

function drawCoverPages(
  finalDoc: PDFDocument,
  regular: PDFFont,
  bold: PDFFont,
  mergeResults: MergeResult[],
  paperOnly: SpokesForm[],
  generatedOn: string,
): void {
  const ink = rgb(0.1, 0.12, 0.16);
  const faint = rgb(0.42, 0.46, 0.52);
  const accent = rgb(0.0, 0.48, 0.68); // SPOKES --primary #007baf

  let page: PDFPage = finalDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const write = (
    text: string,
    opts: { font?: PDFFont; size?: number; color?: typeof ink; indent?: number } = {},
  ) => {
    const size = opts.size ?? 11;
    if (y < MARGIN + LINE_HEIGHT) {
      page = finalDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
    page.drawText(text, {
      x: MARGIN + (opts.indent ?? 0),
      y,
      size,
      font: opts.font ?? regular,
      color: opts.color ?? ink,
    });
    y -= opts.size ? opts.size + 9 : LINE_HEIGHT;
  };

  write("SPOKES Student Orientation", { font: bold, size: 22, color: accent });
  write("Complete Forms Packet", { font: bold, size: 15 });
  write(`Generated ${generatedOn}`, { size: 9, color: faint });
  y -= 6;
  write(
    "Print this packet single-sided. Forms marked (sign) need a student signature.",
    { size: 10, color: faint },
  );
  y -= 10;

  write("Included forms", { font: bold, size: 12 });
  y -= 2;

  let index = 1;
  for (const result of mergeResults) {
    if (!result.doc) continue;
    const sign = result.form.requiresSignature ? "  (sign)" : "";
    const req = result.form.required ? "" : "  (optional)";
    write(`${index}.  ${result.form.title}${sign}${req}`, { size: 10, indent: 4 });
    index += 1;
  }

  const failed = mergeResults.filter((r) => r.form.storageKey && r.error);
  const missing = [
    ...paperOnly.map((form) => ({ title: form.title, reason: "No digital PDF yet" })),
    ...failed.map((r) => ({ title: r.form.title, reason: r.error as string })),
  ];

  if (missing.length > 0) {
    y -= 12;
    write("Add these on paper — not in this packet", {
      font: bold,
      size: 12,
      color: rgb(0.7, 0.33, 0.05),
    });
    y -= 2;
    for (const item of missing) {
      write(`•  ${item.title}  —  ${item.reason}`, { size: 10, indent: 4 });
    }
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "teacher" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { printable, paperOnly } = getOrientationPacket();
  const mergeResults = await loadPrintableForms(printable);

  const finalDoc = await PDFDocument.create();
  const regular = await finalDoc.embedFont(StandardFonts.Helvetica);
  const bold = await finalDoc.embedFont(StandardFonts.HelveticaBold);

  const generatedOn = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  drawCoverPages(finalDoc, regular, bold, mergeResults, paperOnly, generatedOn);

  let mergedFormCount = 0;
  for (const result of mergeResults) {
    if (!result.doc) continue;
    const pages = await finalDoc.copyPages(result.doc, result.doc.getPageIndices());
    for (const page of pages) finalDoc.addPage(page);
    mergedFormCount += 1;
  }

  const pdfBytes = await finalDoc.save();
  const fileName = "SPOKES_Orientation_Forms_Packet.pdf";

  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "no-store",
      // Lightweight signal for the client toast without parsing the PDF.
      "X-Packet-Forms-Included": String(mergedFormCount),
      "X-Packet-Forms-Paper-Only": String(
        paperOnly.length + mergeResults.filter((r) => r.form.storageKey && r.error).length,
      ),
    },
  });
}
