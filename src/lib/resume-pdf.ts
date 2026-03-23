import jsPDF from "jspdf";
import type { ResumeContent } from "@/lib/resume";

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

function drawSectionTitle(doc: jsPDF, title: string, cursor: Cursor) {
  ensureSpace(doc, cursor, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(22, 38, 63);
  doc.text(title.toUpperCase(), 16, cursor.y);
  cursor.y += 2;
  doc.setDrawColor(160, 172, 188);
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

  const cursor: Cursor = { y: 18 };
  const textWidth = 178;

  doc.setTextColor(18, 38, 63);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(name, 16, cursor.y);
  cursor.y += 8;

  doc.setFont("helvetica", "normal");
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
    drawSectionTitle(doc, "Professional Summary", cursor);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    drawWrappedText(doc, resume.objective, 16, cursor, textWidth, 4.7);
    cursor.y += 3;
  }

  if (resume.skills.length > 0) {
    drawSectionTitle(doc, "Skills", cursor);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    drawWrappedText(doc, resume.skills.join(" | "), 16, cursor, textWidth, 4.7);
    cursor.y += 3;
  }

  if (resume.experience.length > 0) {
    drawSectionTitle(doc, "Experience", cursor);
    for (const item of resume.experience) {
      const meta = [item.location, item.dates].filter(Boolean).join(" | ");
      ensureSpace(doc, cursor, 18);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.text([item.title, item.company].filter(Boolean).join(" | "), 16, cursor.y);
      cursor.y += 4.7;
      if (meta) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9.5);
        doc.text(meta, 16, cursor.y);
        cursor.y += 4.4;
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      const bullets = bulletLines(item.description);
      for (const bullet of bullets.length > 0 ? bullets : item.description ? [item.description] : []) {
        drawWrappedText(doc, bullet, 20, cursor, textWidth - 4, 4.4);
      }
      cursor.y += 2.5;
    }
  }

  if (resume.education.length > 0) {
    drawSectionTitle(doc, "Education", cursor);
    for (const item of resume.education) {
      const meta = [item.location, item.dates].filter(Boolean).join(" | ");
      ensureSpace(doc, cursor, 12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.text([item.degree, item.school].filter(Boolean).join(" | "), 16, cursor.y);
      cursor.y += 4.7;
      if (meta) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9.5);
        doc.text(meta, 16, cursor.y);
        cursor.y += 4.4;
      }
      cursor.y += 2.5;
    }
  }

  if (resume.certifications.length > 0) {
    drawSectionTitle(doc, "Certifications", cursor);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    for (const item of resume.certifications) {
      const line = [item.name, item.issuer, item.dates].filter(Boolean).join(" | ");
      drawWrappedText(doc, line, 16, cursor, textWidth, 4.4);
    }
    cursor.y += 2.5;
  }

  if (resume.references) {
    drawSectionTitle(doc, "References", cursor);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    drawWrappedText(doc, resume.references, 16, cursor, textWidth, 4.4);
  }

  return doc.output("arraybuffer");
}
