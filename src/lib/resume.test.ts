import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_RESUME,
  buildResumePlainText,
  buildResumePrintHtml,
  normalizeResumeContent,
  parseStoredResumeData,
} from "@/lib/resume";

test("normalizeResumeContent upgrades legacy resume fields into the shared schema", () => {
  const resume = normalizeResumeContent({
    headline: "Administrative support candidate",
    objective: "Reliable and detail-oriented worker.",
    email: "student@example.com",
    phone: "555-0100",
    location: "Charleston, WV",
    website: "not-a-url",
    skills: ["Microsoft Office", "Customer Service"],
    experience: [
      {
        title: "Volunteer",
        company: "Food Pantry",
        dates: "2025",
        description: "- Helped organize weekly distributions",
      },
    ],
  });

  assert.equal(resume.contact.email, "student@example.com");
  assert.equal(resume.contact.phone, "555-0100");
  assert.equal(resume.contact.location, "Charleston, WV");
  assert.equal(resume.contact.website, "");
  assert.equal(resume.skills.length, 2);
  assert.equal(resume.experience[0]?.company, "Food Pantry");
});

test("parseStoredResumeData returns an empty resume for malformed JSON", () => {
  const resume = parseStoredResumeData("{bad json");
  assert.deepEqual(resume, EMPTY_RESUME);
});

test("resume content defaults font to times and is backward compatible", () => {
  // Old saved resume JSON had no `font` key
  const parsed = normalizeResumeContent({ headline: "Office Assistant" });
  assert.equal(parsed.font, "times");
});

test("resume content keeps a valid font and rejects an invalid one", () => {
  assert.equal(normalizeResumeContent({ font: "lato" }).font, "lato");
  assert.equal(normalizeResumeContent({ font: "comic-sans" }).font, "times");
});

test("print HTML uses the selected core font and no Google Fonts link", () => {
  const html = buildResumePrintHtml("Maria Sanchez", normalizeResumeContent({ font: "arial", headline: "Office" }));
  assert.ok(html.includes("Arial, Helvetica, sans-serif"));
  assert.ok(!html.includes("fonts.googleapis.com"));
});

test("print HTML injects a Google Fonts link for an embedded font", () => {
  const html = buildResumePrintHtml("Maria Sanchez", normalizeResumeContent({ font: "garamond" }));
  assert.ok(html.includes("fonts.googleapis.com"));
  assert.ok(html.includes("EB+Garamond"));
  assert.ok(html.includes(`"EB Garamond", Georgia, serif`));
});

test("buildResumePlainText creates ATS-friendly plain text output", () => {
  const text = buildResumePlainText("Jane Doe", normalizeResumeContent({
    headline: "Office support candidate",
    objective: "Dependable worker with customer service experience.",
    contact: {
      email: "jane@example.com",
      phone: "555-0111",
      location: "Beckley, WV",
      website: "",
      linkedin: "",
    },
    skills: ["Scheduling", "Data Entry"],
    experience: [
      {
        title: "Front Desk Assistant",
        company: "Community Center",
        location: "Beckley, WV",
        dates: "Jan 2025 - Present",
        description: "- Greet visitors\n- Maintain records",
      },
    ],
    references: "Available upon request",
  }));

  assert.match(text, /JANE DOE/);
  assert.match(text, /PROFESSIONAL SUMMARY/);
  assert.match(text, /Scheduling \| Data Entry/);
  assert.match(text, /- Greet visitors/);
  assert.match(text, /Available upon request/);
});
