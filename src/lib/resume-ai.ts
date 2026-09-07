import { z } from "zod";
import type { AIProvider } from "@/lib/ai";
import { EMPTY_RESUME, type ResumeCertification, type ResumeContent, normalizeResumeContent } from "@/lib/resume";

const resumeAssistResponseSchema = z.object({
  resume: z.unknown().default(EMPTY_RESUME),
  missingInformation: z.array(z.string().trim().max(200)).default([]).catch([]),
  notes: z.string().trim().max(1000).default("").catch(""),
});

export type ResumeAssistResponse = {
  resume: ResumeContent;
  missingInformation: string[];
  notes: string;
};

/**
 * What the model is given. No student name and no email: the résumé BODY is
 * what gets rewritten, and neither is a fact the body needs (FERPA review
 * §2.c.3 / W10, 2026-09-06). The stored `existingResume.contact` block is
 * stripped before it is serialised and re-attached on the way out — the same
 * split the Connect packet makes in `packetResumeContent` (SEC-W4).
 */
interface ResumeAssistContext {
  prompt: string;
  existingResume: ResumeContent;
  goals: string[];
  portfolioItems: Array<{ title: string; description: string | null; type: string }>;
  certifications: ResumeCertification[];
}

const EMPTY_CONTACT: ResumeContent["contact"] = {
  email: "",
  phone: "",
  location: "",
  website: "",
  linkedin: "",
};

/**
 * The résumé with its contact block blanked — what the model sees. Mirrors
 * `packetResumeContent` in src/lib/connect/packet.ts; that module imports
 * Prisma and storage, so this résumé path keeps its own four-line copy rather
 * than pull the Connect server module into a unit-testable helper.
 */
function withoutContact(resume: ResumeContent): ResumeContent {
  return { ...resume, contact: { ...EMPTY_CONTACT } };
}

const RESUME_ASSIST_PROMPT = `You are helping write a professional resume for a workforce development student.

Rules:
- Only use facts explicitly present in the provided context.
- Do not invent employers, dates, locations, achievements, certifications, or metrics.
- Rewrite existing information into concise ATS-friendly language.
- Prefer plain wording, action verbs, and single-column resume content.
- If something is missing, leave the field blank and add a short note to missingInformation.
- Keep the resume suitable for both online job applications and printed handouts.
- Experience descriptions should use short bullet-style lines separated by newlines.
- References should usually be "Available upon request" unless specific reference text already exists.
- Do not write contact details (email, phone, address, links). The student's contact block is kept separately and attached after you finish.

Return valid JSON in this exact shape:
{
  "resume": {
    "headline": "",
    "objective": "",
    "skills": [],
    "experience": [
      {
        "title": "",
        "company": "",
        "location": "",
        "dates": "",
        "description": ""
      }
    ],
    "education": [
      {
        "school": "",
        "degree": "",
        "location": "",
        "dates": ""
      }
    ],
    "certifications": [
      {
        "name": "",
        "issuer": "",
        "dates": ""
      }
    ],
    "references": ""
  },
  "missingInformation": [],
  "notes": ""
}`;

function buildContextMessage(context: ResumeAssistContext): string {
  const goals = context.goals.length > 0
    ? context.goals.map((goal) => `- ${goal}`).join("\n")
    : "- None recorded";

  const portfolio = context.portfolioItems.length > 0
    ? context.portfolioItems
      .slice(0, 8)
      .map((item) => `- [${item.type}] ${item.title}${item.description ? `: ${item.description}` : ""}`)
      .join("\n")
    : "- None recorded";

  const certifications = context.certifications.length > 0
    ? context.certifications
      .map((item) => `- ${item.name}${item.issuer ? ` | ${item.issuer}` : ""}${item.dates ? ` | ${item.dates}` : ""}`)
      .join("\n")
    : "- None recorded";

  return [
    `Targeting notes from user: ${context.prompt || "(none provided)"}`,
    "",
    "Existing resume JSON (contact block withheld):",
    JSON.stringify(withoutContact(context.existingResume), null, 2),
    "",
    "Recorded goals:",
    goals,
    "",
    "Portfolio items:",
    portfolio,
    "",
    "Known certifications:",
    certifications,
    "",
    "Draft or refine the resume now.",
  ].join("\n");
}

export async function generateResumeDraft(provider: AIProvider, context: ResumeAssistContext): Promise<ResumeAssistResponse> {
  const responseText = await provider.generateStructuredResponse(RESUME_ASSIST_PROMPT, [
    { role: "user", content: buildContextMessage(context) },
  ]);

  const parsed = resumeAssistResponseSchema.parse(JSON.parse(responseText));

  // Re-attach the stored contact block locally. Anything the model put under
  // `contact` is discarded: it never saw the real one, so it can only have
  // invented it.
  const draft = normalizeResumeContent(parsed.resume);
  return {
    resume: { ...draft, contact: { ...context.existingResume.contact } },
    missingInformation: parsed.missingInformation.filter(Boolean),
    notes: parsed.notes,
  };
}
