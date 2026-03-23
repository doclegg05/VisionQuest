import assert from "node:assert/strict";
import test from "node:test";
import { generateResumePdf, generateResumePdfArrayBuffer } from "@/lib/resume-pdf";
import { normalizeResumeContent } from "@/lib/resume";

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
