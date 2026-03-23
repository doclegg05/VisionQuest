import { z } from "zod";

const trimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .catch("")
    .default("");

const optionalUrlString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => value === "" || /^https?:\/\//i.test(value), {
      message: "Links must start with http:// or https://",
    })
    .catch("")
    .default("");

export const resumeContactSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").or(z.literal("")).catch("").default(""),
  phone: trimmedString(100),
  location: trimmedString(200),
  website: optionalUrlString(200),
  linkedin: optionalUrlString(200),
});

export const resumeExperienceSchema = z.object({
  title: trimmedString(120),
  company: trimmedString(120),
  location: trimmedString(120),
  dates: trimmedString(80),
  description: trimmedString(4000),
});

export const resumeEducationSchema = z.object({
  school: trimmedString(160),
  degree: trimmedString(160),
  location: trimmedString(120),
  dates: trimmedString(80),
});

export const resumeCertificationSchema = z.object({
  name: trimmedString(160),
  issuer: trimmedString(160),
  dates: trimmedString(80),
});

export const resumeContentSchema = z.object({
  headline: trimmedString(160),
  objective: trimmedString(2000),
  contact: resumeContactSchema.default({
    email: "",
    phone: "",
    location: "",
    website: "",
    linkedin: "",
  }),
  skills: z.array(trimmedString(80)).default([]).catch([]),
  experience: z.array(resumeExperienceSchema).default([]).catch([]),
  education: z.array(resumeEducationSchema).default([]).catch([]),
  certifications: z.array(resumeCertificationSchema).default([]).catch([]),
  references: trimmedString(1000),
});

export const resumeSaveSchema = z.object({
  resume: z.unknown().optional(),
});

export const resumeAssistRequestSchema = z.object({
  prompt: z.string().trim().max(4000).optional().default(""),
});

export type ResumeContact = z.infer<typeof resumeContactSchema>;
export type ResumeExperience = z.infer<typeof resumeExperienceSchema>;
export type ResumeEducation = z.infer<typeof resumeEducationSchema>;
export type ResumeCertification = z.infer<typeof resumeCertificationSchema>;
export type ResumeContent = z.infer<typeof resumeContentSchema>;
export type ResumeAssistRequest = z.infer<typeof resumeAssistRequestSchema>;

export const EMPTY_RESUME: ResumeContent = resumeContentSchema.parse({});

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeExperienceList(input: unknown): ResumeExperience[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry) => {
    const item = normalizeObject(entry);
    return resumeExperienceSchema.parse({
      title: item.title,
      company: item.company,
      location: item.location,
      dates: item.dates,
      description: item.description,
    });
  });
}

function normalizeEducationList(input: unknown): ResumeEducation[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry) => {
    const item = normalizeObject(entry);
    return resumeEducationSchema.parse({
      school: item.school,
      degree: item.degree,
      location: item.location,
      dates: item.dates,
    });
  });
}

function normalizeCertificationList(input: unknown): ResumeCertification[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry) => {
    const item = normalizeObject(entry);
    return resumeCertificationSchema.parse({
      name: item.name,
      issuer: item.issuer,
      dates: item.dates,
    });
  });
}

export function normalizeResumeContent(input: unknown): ResumeContent {
  const raw = normalizeObject(input);
  const legacyContact = {
    email: raw.email,
    phone: raw.phone,
    location: raw.location,
    website: raw.website,
    linkedin: raw.linkedin,
  };

  return resumeContentSchema.parse({
    headline: raw.headline,
    objective: raw.objective,
    contact: {
      ...legacyContact,
      ...normalizeObject(raw.contact),
    },
    skills: normalizeStringList(raw.skills),
    experience: normalizeExperienceList(raw.experience),
    education: normalizeEducationList(raw.education),
    certifications: normalizeCertificationList(raw.certifications),
    references: raw.references,
  });
}

export function parseStoredResumeData(raw: string | null | undefined): ResumeContent {
  if (!raw) return EMPTY_RESUME;

  try {
    return normalizeResumeContent(JSON.parse(raw));
  } catch {
    return EMPTY_RESUME;
  }
}

export function isResumeEmpty(resume: ResumeContent): boolean {
  return (
    !resume.headline &&
    !resume.objective &&
    !resume.contact.email &&
    !resume.contact.phone &&
    !resume.contact.location &&
    !resume.contact.website &&
    !resume.contact.linkedin &&
    resume.skills.length === 0 &&
    resume.experience.length === 0 &&
    resume.education.length === 0 &&
    resume.certifications.length === 0 &&
    !resume.references
  );
}

function pushSection(lines: string[], title: string, body: string[]) {
  const filtered = body.map((line) => line.trim()).filter(Boolean);
  if (filtered.length === 0) return;
  lines.push(title.toUpperCase());
  lines.push(...filtered);
  lines.push("");
}

function bulletizeText(value: string): string[] {
  return value
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => `- ${line}`);
}

export function buildResumePlainText(name: string, resume: ResumeContent): string {
  const lines: string[] = [];
  const displayName = name.trim();

  if (displayName) lines.push(displayName.toUpperCase());
  if (resume.headline) lines.push(resume.headline);

  const contactBits = [
    resume.contact.location,
    resume.contact.phone,
    resume.contact.email,
    resume.contact.website,
    resume.contact.linkedin,
  ].filter(Boolean);

  if (contactBits.length > 0) lines.push(contactBits.join(" | "));
  if (lines.length > 0) lines.push("");

  pushSection(lines, "Professional Summary", [resume.objective]);
  pushSection(lines, "Skills", resume.skills.length > 0 ? [resume.skills.join(" | ")] : []);

  if (resume.experience.length > 0) {
    const experienceLines = resume.experience.flatMap((item) => {
      const heading = [item.title, item.company].filter(Boolean).join(" | ");
      const meta = [item.location, item.dates].filter(Boolean).join(" | ");
      return [heading, meta, ...bulletizeText(item.description), ""];
    });
    pushSection(lines, "Experience", experienceLines);
  }

  if (resume.education.length > 0) {
    const educationLines = resume.education.flatMap((item) => {
      const heading = [item.degree, item.school].filter(Boolean).join(" | ");
      const meta = [item.location, item.dates].filter(Boolean).join(" | ");
      return [heading, meta, ""];
    });
    pushSection(lines, "Education", educationLines);
  }

  if (resume.certifications.length > 0) {
    const certLines = resume.certifications.flatMap((item) => {
      const heading = [item.name, item.issuer].filter(Boolean).join(" | ");
      return [[heading, item.dates].filter(Boolean).join(" | ")];
    });
    pushSection(lines, "Certifications", certLines);
  }

  pushSection(lines, "References", [resume.references]);

  return lines.join("\n").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function sectionHtml(title: string, body: string): string {
  if (!body.trim()) return "";
  return `<section class="section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

export function buildResumePrintHtml(name: string, resume: ResumeContent): string {
  const summaryHtml = resume.objective
    ? `<p>${escapeHtml(resume.objective).replace(/\n/g, "<br />")}</p>`
    : "";

  const skillsHtml = resume.skills.length > 0
    ? `<p>${escapeHtml(resume.skills.join(" | "))}</p>`
    : "";

  const experienceHtml = resume.experience
    .map((item) => {
      const bullets = bulletizeText(item.description)
        .map((line) => `<li>${escapeHtml(line.replace(/^- /, ""))}</li>`)
        .join("");

      const meta = [item.location, item.dates].filter(Boolean).join(" | ");
      return `
        <article class="entry">
          <div class="entry-header">
            <div>
              <h3>${escapeHtml(item.title || item.company)}</h3>
              <p class="entry-subtitle">${escapeHtml(item.company)}</p>
            </div>
            ${meta ? `<p class="entry-meta">${escapeHtml(meta)}</p>` : ""}
          </div>
          ${bullets ? `<ul>${bullets}</ul>` : ""}
        </article>
      `;
    })
    .join("");

  const educationHtml = resume.education
    .map((item) => {
      const meta = [item.location, item.dates].filter(Boolean).join(" | ");
      return `
        <article class="entry">
          <div class="entry-header">
            <div>
              <h3>${escapeHtml(item.degree || item.school)}</h3>
              <p class="entry-subtitle">${escapeHtml(item.school)}</p>
            </div>
            ${meta ? `<p class="entry-meta">${escapeHtml(meta)}</p>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  const certificationHtml = resume.certifications
    .map((item) => {
      const meta = [item.issuer, item.dates].filter(Boolean).join(" | ");
      return `<p class="simple-line"><strong>${escapeHtml(item.name)}</strong>${meta ? ` - ${escapeHtml(meta)}` : ""}</p>`;
    })
    .join("");

  const referencesHtml = resume.references
    ? `<p>${escapeHtml(resume.references).replace(/\n/g, "<br />")}</p>`
    : "";

  const contactBits = [
    resume.contact.location,
    resume.contact.phone,
    resume.contact.email,
    resume.contact.website,
    resume.contact.linkedin,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(name)} Resume</title>
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: #f4f1ea;
        color: #16263f;
        font-family: Georgia, "Times New Roman", serif;
      }
      .page {
        width: 8.5in;
        min-height: 11in;
        margin: 0 auto;
        background: white;
        padding: 0.6in;
      }
      header {
        border-bottom: 2px solid #16263f;
        padding-bottom: 0.2in;
        margin-bottom: 0.25in;
      }
      h1 {
        margin: 0;
        font-size: 24pt;
        letter-spacing: 0.04em;
      }
      .headline {
        margin: 0.08in 0 0;
        font-size: 11pt;
        font-weight: 600;
      }
      .contact {
        margin-top: 0.12in;
        font-size: 10pt;
        line-height: 1.4;
      }
      .section {
        margin-top: 0.22in;
        break-inside: avoid;
      }
      .section h2 {
        margin: 0 0 0.08in;
        font-size: 11pt;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        border-bottom: 1px solid #9ca7b6;
        padding-bottom: 0.04in;
      }
      .section p,
      .section li,
      .entry-subtitle,
      .entry-meta {
        font-size: 10pt;
        line-height: 1.45;
      }
      .entry {
        margin-bottom: 0.16in;
      }
      .entry-header {
        display: flex;
        justify-content: space-between;
        gap: 0.2in;
      }
      .entry-header h3 {
        margin: 0;
        font-size: 11pt;
      }
      .entry-subtitle,
      .entry-meta,
      .simple-line {
        margin: 0.03in 0 0;
      }
      ul {
        margin: 0.08in 0 0;
        padding-left: 0.2in;
      }
      @media print {
        body {
          background: white;
        }
        .page {
          width: auto;
          min-height: auto;
          margin: 0;
          padding: 0.45in 0.5in;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header>
        <h1>${escapeHtml(name)}</h1>
        ${resume.headline ? `<p class="headline">${escapeHtml(resume.headline)}</p>` : ""}
        ${contactBits.length > 0 ? `<p class="contact">${escapeHtml(contactBits.join(" | "))}</p>` : ""}
      </header>
      ${sectionHtml("Professional Summary", summaryHtml)}
      ${sectionHtml("Skills", skillsHtml)}
      ${sectionHtml("Experience", experienceHtml)}
      ${sectionHtml("Education", educationHtml)}
      ${sectionHtml("Certifications", certificationHtml)}
      ${sectionHtml("References", referencesHtml)}
    </main>
  </body>
</html>`;
}
