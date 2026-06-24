import assert from "node:assert/strict";
import test from "node:test";
import { generateResumePdf, generateResumePdfArrayBuffer } from "@/lib/resume-pdf";
import { normalizeResumeContent } from "@/lib/resume";

/**
 * Resolves which BaseFonts are ACTUALLY used in the content stream by mapping
 * each `/Fn ... Tf` reference through the /Font resource dict to its /BaseFont.
 * jsPDF embeds all 14 standard fonts in every PDF, so only the *used* refs
 * distinguish the selected font.
 */
function activeBaseFonts(pdf: string): string[] {
  const refByKey = new Map<string, string>();
  for (const dict of pdf.matchAll(/\/Font\s*<<([^>]*)>>/g)) {
    for (const m of dict[1].matchAll(/\/(F\d+)\s+(\d+)\s+(\d+)\s+R/g)) {
      refByKey.set(m[1], `${m[2]} ${m[3]}`);
    }
  }
  const baseFontByObj = new Map<string, string>();
  for (const m of pdf.matchAll(/(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g)) {
    const bf = m[3].match(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/);
    if (bf) baseFontByObj.set(`${m[1]} ${m[2]}`, bf[1]);
  }
  const used = new Set<string>();
  for (const m of pdf.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf/g)) {
    const ref = refByKey.get(m[1]);
    const bf = ref ? baseFontByObj.get(ref) : undefined;
    if (bf) used.add(bf);
  }
  return [...used];
}

test("generateResumePdfArrayBuffer returns PDF bytes for a populated resume", async () => {
  const resume = normalizeResumeContent({
    headline: "Help Desk Support Specialist",
    objective: "Reliable support specialist with customer service and device troubleshooting experience.",
    contact: {
      email: "student@example.com",
      phone: "555-111-2222",
      location: "Charleston, WV",
      website: "",
      linkedin: "",
    },
    skills: ["Troubleshooting", "Ticketing systems"],
    experience: [
      {
        title: "IT Support Intern",
        company: "VisionQuest",
        location: "Charleston, WV",
        dates: "2025 - Present",
        description: "- Resolved common laptop issues\n- Documented support tickets",
      },
    ],
  });

  const buffer = await generateResumePdfArrayBuffer("Test Student", resume);
  const header = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 4)));

  assert.ok(buffer.byteLength > 1000);
  assert.equal(header, "%PDF");
});

test("generateResumePdf returns a PDF blob for browser downloads", async () => {
  const resume = normalizeResumeContent({
    headline: "Administrative Assistant",
    skills: ["Scheduling"],
  });

  const pdf = await generateResumePdf("Test Student", resume);

  assert.equal(pdf.type, "application/pdf");
  assert.ok(pdf.size > 0);
});

test("default resume PDF actually renders text in Times", async () => {
  const resume = normalizeResumeContent({ headline: "Office Assistant", skills: ["Scheduling"] });
  const buffer = await generateResumePdfArrayBuffer("Test Student", resume);
  const fonts = activeBaseFonts(Buffer.from(buffer).toString("latin1"));
  assert.ok(fonts.length > 0, "expected at least one used font");
  assert.ok(fonts.every((f) => f.startsWith("Times")), `expected only Times fonts, got ${JSON.stringify(fonts)}`);
});

test("arial resume PDF actually renders text in Helvetica", async () => {
  const resume = normalizeResumeContent({ headline: "Office Assistant", font: "arial", skills: ["Scheduling"] });
  const buffer = await generateResumePdfArrayBuffer("Test Student", resume);
  const fonts = activeBaseFonts(Buffer.from(buffer).toString("latin1"));
  assert.ok(fonts.length > 0, "expected at least one used font");
  assert.ok(fonts.every((f) => f.startsWith("Helvetica")), `expected only Helvetica fonts, got ${JSON.stringify(fonts)}`);
});
