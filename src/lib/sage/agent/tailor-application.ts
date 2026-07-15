import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { resolveAiProvider } from "@/lib/ai/provider";
import { prisma } from "@/lib/db";
import { withUsageLogging } from "@/lib/llm-usage";
import type {
  ResumeCertification,
  ResumeContent,
  ResumeExperience,
} from "@/lib/resume";
import { resumeContentSchema } from "@/lib/resume";
import { sanitizeForPrompt } from "@/lib/sage/system-prompts";

export interface TailoringSource {
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    description: string;
    salary: string | null;
    clusters: string[];
  };
  profile: {
    resume: ResumeContent;
    completedCertifications: string[];
    nationalClusters: string | null;
    transferableSkills: string | null;
  };
  grounding: string;
}

const boundedText = (max: number) => z.string().trim().max(max);

const experienceFactSchema = z.object({
  title: boundedText(120).min(1),
  employer: boundedText(120).min(1),
  dates: boundedText(80),
}).strict();

const credentialFactSchema = z.object({
  name: boundedText(160).min(1),
  issuer: boundedText(160),
  dates: boundedText(80),
}).strict();

export const tailoringPlanSchema = z.object({
  skills: z.array(boundedText(80).min(1)).max(12),
  experience: z.array(experienceFactSchema).max(8),
  credentials: z.array(credentialFactSchema).max(12),
  jobKeywords: z.array(boundedText(160).min(1)).max(12),
}).strict();

export type TailoringPlan = z.infer<typeof tailoringPlanSchema>;

export class GroundingViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroundingViolationError";
  }
}

const TAILORING_SYSTEM_PROMPT = `You select emphasis for a job application. You do not write new history.

Return ONLY JSON with exactly these arrays:
{
  "skills": ["exact skill from STUDENT PROFILE"],
  "experience": [{"title":"exact title","employer":"exact employer","dates":"exact dates"}],
  "credentials": [{"name":"exact credential","issuer":"exact issuer or empty string","dates":"exact dates or empty string"}],
  "jobKeywords": ["exact short phrase copied from JOB POSTING"]
}

Every value must be copied exactly from the supplied grounding data. Select and reorder only. Never infer, improve, paraphrase, or invent an employer, title, date, skill, credential, issuer, or job requirement. Use an empty array when the source has no supported value.`;

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function exactKey(values: string[]): string {
  // JSON.stringify keeps field boundaries unambiguous even if a value contains
  // control characters, so fabricated facts can't splice across the join and
  // collide with a differently-partitioned real record.
  return JSON.stringify(values.map(normalized));
}

function assertExactFact(
  kind: string,
  values: string[],
  allowed: ReadonlySet<string>,
): void {
  if (!allowed.has(exactKey(values))) {
    throw new GroundingViolationError(
      `Generated ${kind} is not present in gatherJobAndProfile() output: ${values.filter(Boolean).join(" | ")}`,
    );
  }
}

/**
 * Fail closed before persistence. The model can only select exact source facts;
 * it cannot introduce even a plausible-looking employer, date, credential,
 * skill, or posting phrase.
 */
export function assertTailoringPlanGrounded(
  plan: TailoringPlan,
  source: TailoringSource,
): void {
  const skillFacts = new Set(source.profile.resume.skills.map((skill) => exactKey([skill])));
  for (const skill of plan.skills) {
    assertExactFact("skill", [skill], skillFacts);
  }

  const experienceFacts = new Set(
    source.profile.resume.experience.map((item) =>
      exactKey([item.title, item.company, item.dates]),
    ),
  );
  for (const item of plan.experience) {
    assertExactFact(
      "employer, title, or date",
      [item.title, item.employer, item.dates],
      experienceFacts,
    );
  }

  const credentialFacts = new Set([
    ...source.profile.resume.certifications.map((item) =>
      exactKey([item.name, item.issuer, item.dates]),
    ),
    ...source.profile.completedCertifications.map((name) => exactKey([name, "", ""])),
  ]);
  for (const item of plan.credentials) {
    assertExactFact(
      "credential, issuer, or date",
      [item.name, item.issuer, item.dates],
      credentialFacts,
    );
  }

  const posting = normalized(`${source.job.title}\n${source.job.description}`);
  for (const keyword of plan.jobKeywords) {
    if (!posting.includes(normalized(keyword))) {
      throw new GroundingViolationError(
        `Generated job keyword is not present in gatherJobAndProfile() output: ${keyword}`,
      );
    }
  }
}

function uniqueExact(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalized(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reorderExperience(
  source: ResumeExperience[],
  selected: TailoringPlan["experience"],
): ResumeExperience[] {
  const selectedKeys = selected.map((item) => exactKey([item.title, item.employer, item.dates]));
  const byKey = new Map(
    source.map((item) => [exactKey([item.title, item.company, item.dates]), item]),
  );
  const emphasized = selectedKeys.flatMap((key) => {
    const item = byKey.get(key);
    return item ? [item] : [];
  });
  const selectedSet = new Set(selectedKeys);
  return [
    ...emphasized,
    ...source.filter(
      (item) => !selectedSet.has(exactKey([item.title, item.company, item.dates])),
    ),
  ];
}

function credentialKey(item: ResumeCertification): string {
  return exactKey([item.name, item.issuer, item.dates]);
}

function reorderCredentials(
  source: ResumeCertification[],
  selected: TailoringPlan["credentials"],
): ResumeCertification[] {
  const sourceByKey = new Map(source.map((item) => [credentialKey(item), item]));
  const selectedEntries = selected.map((item) => ({
    key: exactKey([item.name, item.issuer, item.dates]),
    value: sourceByKey.get(exactKey([item.name, item.issuer, item.dates])) ?? {
      name: item.name,
      issuer: item.issuer,
      dates: item.dates,
    },
  }));
  const selectedSet = new Set(selectedEntries.map((entry) => entry.key));
  return [
    ...selectedEntries.map((entry) => entry.value),
    ...source.filter((item) => !selectedSet.has(credentialKey(item))),
  ];
}

function renderTailoredResume(
  source: TailoringSource,
  plan: TailoringPlan,
): ResumeContent {
  const base = source.profile.resume;
  const skills = uniqueExact([...plan.skills, ...base.skills]);
  const objectiveFacts = [
    `Applying for the ${source.job.title} role at ${source.job.company}.`,
    skills.length > 0 ? `Relevant skills: ${skills.slice(0, 6).join(", ")}.` : "",
    plan.credentials.length > 0
      ? `Completed credentials: ${plan.credentials.map((item) => item.name).join(", ")}.`
      : "",
  ].filter(Boolean);

  return resumeContentSchema.parse({
    ...base,
    objective: objectiveFacts.join(" "),
    skills,
    experience: reorderExperience(base.experience, plan.experience),
    certifications: reorderCredentials(base.certifications, plan.credentials),
  });
}

function renderCoverLetter(source: TailoringSource, plan: TailoringPlan): string {
  const paragraphs = [
    "[Your Name]\n[Your Contact Information]\n[Date]",
    "Dear Hiring Team,",
    `I am applying for the ${source.job.title} position at ${source.job.company}.`,
  ];

  const evidence: string[] = [];
  if (plan.jobKeywords.length > 0) {
    evidence.push(`The posting emphasizes ${plan.jobKeywords.slice(0, 4).join(", ")}.`);
  }
  if (plan.skills.length > 0) {
    evidence.push(`My relevant skills include ${plan.skills.slice(0, 6).join(", ")}.`);
  }
  if (plan.experience.length > 0) {
    evidence.push(
      `My background includes ${plan.experience
        .slice(0, 2)
        .map((item) =>
          `${item.title} at ${item.employer}${item.dates ? ` (${item.dates})` : ""}`,
        )
        .join(" and ")}.`,
    );
  }
  if (plan.credentials.length > 0) {
    evidence.push(
      `I have completed ${plan.credentials.map((item) => item.name).join(", ")}.`,
    );
  }
  if (evidence.length > 0) paragraphs.push(evidence.join(" "));

  paragraphs.push(
    "I would welcome the opportunity to discuss how my background can support this role. Thank you for your time and consideration.",
    "Sincerely,\n[Your Name]",
  );
  return paragraphs.join("\n\n");
}

async function generateGroundedPlan(
  studentId: string,
  source: TailoringSource,
): Promise<TailoringPlan> {
  const baseProvider = await resolveAiProvider({
    studentId,
    task: "tailor_application",
    sensitivity: "student_record",
  });
  const provider = withUsageLogging(baseProvider, {
    studentId,
    callSite: "sage_agent.tailor_application",
  });
  const raw = await provider.generateStructuredResponse(
    TAILORING_SYSTEM_PROMPT,
    [
      {
        role: "user",
        content:
          `[GROUNDING_DATA_START]\n${sanitizeForPrompt(source.grounding)}\n[GROUNDING_DATA_END]\n\n` +
          "Select the strongest exact facts for this application.",
      },
    ],
    undefined,
    { temperature: 0 },
  );
  const plan = tailoringPlanSchema.parse(JSON.parse(raw));
  assertTailoringPlanGrounded(plan, source);
  return plan;
}

export async function createTailoredApplication(
  studentId: string,
  jobListingId: string,
  source: TailoringSource,
): Promise<{
  resumeVersionId: string;
  coverLetterId: string;
  version: number;
}> {
  if (source.job.id !== jobListingId) {
    throw new GroundingViolationError("The gathered job does not match the requested listing.");
  }

  const plan = await generateGroundedPlan(studentId, source);
  const resume = renderTailoredResume(source, plan);
  const coverLetter = renderCoverLetter(source, plan);

  const [latestResume, latestLetter] = await Promise.all([
    prisma.resumeVersion.findFirst({
      where: { studentId, jobListingId },
      orderBy: { version: "desc" },
      select: { version: true },
    }),
    prisma.coverLetter.findFirst({
      where: { studentId, jobListingId },
      orderBy: { version: "desc" },
      select: { version: true },
    }),
  ]);
  const version = Math.max(latestResume?.version ?? 0, latestLetter?.version ?? 0) + 1;

  const [resumeVersion, savedCoverLetter] = await prisma.$transaction([
    prisma.resumeVersion.create({
      data: {
        studentId,
        jobListingId,
        version,
        content: resume as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    }),
    prisma.coverLetter.create({
      data: { studentId, jobListingId, version, content: coverLetter },
      select: { id: true },
    }),
  ]);

  return {
    resumeVersionId: resumeVersion.id,
    coverLetterId: savedCoverLetter.id,
    version,
  };
}
