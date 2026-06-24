import jsPDF from "jspdf";
import type { ResumeContent } from "@/lib/resume";
import { getResumeFont, RESUME_RGB, type ResumeFont } from "@/lib/resume-layout";

/**
 * jsPDF throws if a font/style pair was never registered. Core fonts have
 * italic; embedded fonts here register only normal + bold, so fall italic → normal.
 */
function fontStyle(font: ResumeFont, style: "normal" | "bold" | "italic"): string {
  if (style === "italic" && font.kind === "embedded") return "normal";
  return style;
}

interface Cursor {
  y: number;
}

function bulletLines(value: string): string[] {
  return value
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => `- ${line}`);
}

function ensureSpace(doc: jsPDF, cursor: Cursor, needed: number) {
  const bottom = doc.internal.pageSize.getHeight() - 18;
  if (cursor.y + needed <= bottom) return;
  doc.addPage();
  cursor.y = 18;
}

function drawWrappedText(doc: jsPDF, text: string, x: number, cursor: Cursor, width: number, lineHeight: number) {
  if (!text.trim()) return;
  const lines = doc.splitTextToSize(text, width) as string[];
  ensureSpace(doc, cursor, lines.length * lineHeight + 2);
  doc.text(lines, x, cursor.y);
  cursor.y += lines.length * lineHeight;
}

function drawSectionTitle(doc: jsPDF, title: string, cursor: Cursor, font: ResumeFont) {
  ensureSpace(doc, cursor, 14);
  doc.setFont(font.jsPdfFont, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...RESUME_RGB.ink);
  doc.text(title.toUpperCase(), 16, cursor.y);
  cursor.y += 2;
  doc.setDrawColor(...RESUME_RGB.rule);
  doc.setLineWidth(0.3);
  doc.line(16, cursor.y, 194, cursor.y);
  cursor.y += 6;
}

export async function generateResumePdf(name: string, resume: ResumeContent): Promise<Blob> {
  const buffer = await generateResumePdfArrayBuffer(name, resume);
  return new Blob([buffer], { type: "application/pdf" });
}

export async function generateResumePdfArrayBuffer(name: string, resume: ResumeContent): Promise<ArrayBuffer> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "letter",
  });

  const font = getResumeFont(resume.font);
  const cursor: Cursor = { y: 18 };
  const textWidth = 178;

  doc.setTextColor(...RESUME_RGB.ink);
  doc.setFont(font.jsPdfFont, fontStyle(font, "bold"));
  doc.setFontSize(20);
  doc.text(name, 16, cursor.y);
  cursor.y += 8;

  doc.setFont(font.jsPdfFont, fontStyle(font, "normal"));
  doc.setFontSize(11);
  if (resume.headline) {
    doc.text(resume.headline, 16, cursor.y);
    cursor.y += 6;
  }

  const contactBits = [
    resume.contact.location,
    resume.contact.phone,
    resume.contact.email,
    resume.contact.website,
    resume.contact.linkedin,
  ].filter(Boolean);

  if (contactBits.length > 0) {
    doc.setFontSize(9.5);
    drawWrappedText(doc, contactBits.join(" | "), 16, cursor, textWidth, 4.5);
    cursor.y += 1;
  }

  if (resume.objective) {
    drawSectionTitle(doc, "Professional Summary", cursor, font);
    doc.setFont(font.jsPdfFont, fontStyle(font, "normal"));
    doc.setFontSize(10);
    drawWrappedText(doc, resume.objective, 16, cursor, textWidth, 4.7);
    cursor.y += 3;
  }

  if (resume.skills.length > 0) {
    drawSectionTitle(doc, "Skills", cursor, font);
    doc.setFont(font.jsPdfFont, fontStyle(font, "normal"));
    doc.setFontSize(10);
    drawWrappedText(doc, resume.skills.join(" | "), 16, cursor, textWidth, 4.7);
    cursor.y += 3;
  }

  if (resume.experience.length > 0) {
    drawSectionTitle(doc, "Experience", cursor, font);
    for (const item of resume.experience) {
      const meta = [item.location, item.dates].filter(Boolean).join(" | ");
      ensureSpace(doc, cursor, 18);
      doc.setFont(font.jsPdfFont, fontStyle(font, "bold"));
      doc.setFontSize(10.5);
      doc.text([item.title, item.company].filter(Boolean).join(" | "), 16, cursor.y);
      cursor.y += 4.7;
      if (meta) {
        doc.setFont(font.jsPdfFont, fontStyle(font, "italic"));
        doc.setFontSize(9.5);
        doc.text(meta, 16, cursor.y);
        cursor.y += 4.4;
      }

      doc.setFont(font.jsPdfFont, fontStyle(font, "normal"));
      doc.setFontSize(9.5);
      const bullets = bulletLines(item.description);
      for (const bullet of bullets.length > 0 ? bullets : item.description ? [item.description] : []) {
        drawWrappedText(doc, bullet, 20, cursor, textWidth - 4, 4.4);
      }
      cursor.y += 2.5;
    }
  }

  if (resume.education.length > 0) {
    drawSectionTitle(doc, "Education", cursor, font);
    for (const item of resume.education) {
      const meta = [item.location, item.dates].filter(Boolean).join(" | ");
      ensureSpace(doc, cursor, 12);
      doc.setFont(font.jsPdfFont, fontStyle(font, "bold"));
      doc.setFontSize(10.5);
      doc.text([item.degree, item.school].filter(Boolean).join(" | "), 16, cursor.y);
      cursor.y += 4.7;
      if (meta) {
        doc.setFont(font.jsPdfFont, fontStyle(font, "italic"));
        doc.setFontSize(9.5);
        doc.text(meta, 16, cursor.y);
        cursor.y += 4.4;
      }
      cursor.y += 2.5;
    }
  }

  if (resume.certifications.length > 0) {
    drawSectionTitle(doc, "Certifications", cursor, font);
    doc.setFont(font.jsPdfFont, fontStyle(font, "normal"));
    doc.setFontSize(9.5);
    for (const item of resume.certifications) {
      const line = [item.name, item.issuer, item.dates].filter(Boolean).join(" | ");
      drawWrappedText(doc, line, 16, cursor, textWidth, 4.4);
    }
    cursor.y += 2.5;
  }

  if (resume.references) {
    drawSectionTitle(doc, "References", cursor, font);
    doc.setFont(font.jsPdfFont, fontStyle(font, "normal"));
    doc.setFontSize(9.5);
    drawWrappedText(doc, resume.references, 16, cursor, textWidth, 4.4);
  }

  return doc.output("arraybuffer");
}
