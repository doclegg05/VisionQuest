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

interface ResumeAssistContext {
  studentName: string;
  studentEmail: string;
  prompt: string;
  existingResume: ResumeContent;
  goals: string[];
  portfolioItems: Array<{ title: string; description: string | null; type: string }>;
  certifications: ResumeCertification[];
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

Return valid JSON in this exact shape:
{
  "resume": {
    "headline": "",
    "objective": "",
    "contact": {
      "email": "",
      "phone": "",
      "location": "",
      "website": "",
      "linkedin": ""
    },
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
    `Student name: ${context.studentName}`,
    `Student email on file: ${context.studentEmail || "(none)"}`,
    `Targeting notes from user: ${context.prompt || "(none provided)"}`,
    "",
    "Existing resume JSON:",
    JSON.stringify(context.existingResume, null, 2),
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

  return {
    resume: normalizeResumeContent(parsed.resume),
    missingInformation: parsed.missingInformation.filter(Boolean),
    notes: parsed.notes,
  };
}
