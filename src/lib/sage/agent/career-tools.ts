/**
 * Career tools (Phase 5): Sage-connected resume editing and job-match analysis.
 *
 * propose_resume_edit follows the Reactive Resume propose→review pattern,
 * implemented on our Phase 3 confirmation machinery: the unconfirmed call
 * returns a card showing exactly what would change; the confirmed call applies
 * it. Edits never touch ResumeData without an explicit accept. v1 edit surface
 * is deliberately narrow — headline, objective, skills, references — the
 * sections where Sage drafting adds value with low structural risk.
 *
 * analyze_job_match is read-only: it feeds Sage the REAL posting text plus the
 * student's actual skills/certs/clusters so the gap analysis is grounded, not
 * hallucinated.
 */

import { prisma } from "@/lib/db";
import {
  parseStoredResumeData,
  resumeContentSchema,
  type ResumeContent,
} from "@/lib/resume";
import { operationIdFor, recordOperation, type OperationActorType } from "../operations";
import { createConfirmationToken, verifyConfirmationToken } from "./confirmation";
import type { AgentTool, AgentToolResult } from "./types";

const EDITABLE_SECTIONS = ["headline", "objective", "skills", "references"] as const;
type EditableSection = (typeof EDITABLE_SECTIONS)[number];

const EDIT_OPERATIONS = ["replace", "append"] as const;

function actorTypeFor(role: string): OperationActorType {
  if (role === "teacher") return "teacher";
  if (role === "admin") return "admin";
  return "student";
}

function previewOf(value: string, max = 120): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function applyEdit(
  resume: ResumeContent,
  section: EditableSection,
  operation: "replace" | "append",
  value: string,
): ResumeContent {
  if (section === "skills") {
    const incoming = value
      .split(/[,\n]/)
      .map((skill) => skill.trim())
      .filter((skill) => skill.length > 0);
    const skills =
      operation === "append"
        ? [...new Set([...resume.skills, ...incoming])]
        : incoming;
    return { ...resume, skills };
  }

  const current = resume[section];
  const next = operation === "append" && current ? `${current}\n${value}` : value;
  return { ...resume, [section]: next };
}

const proposeResumeEdit: AgentTool = {
  name: "propose_resume_edit",
  description:
    "Propose an edit to one section of the student's resume (headline, objective, skills, or references). The student sees exactly what would change and must confirm before anything is saved.",
  parameters: {
    type: "object",
    properties: {
      section: {
        type: "string",
        enum: EDITABLE_SECTIONS,
        description: "Which resume section to edit.",
      },
      operation: {
        type: "string",
        enum: EDIT_OPERATIONS,
        description: "replace the section, or append to it (skills append de-duplicates).",
      },
      value: {
        type: "string",
        description: "The new text. For skills: comma- or newline-separated list.",
      },
    },
    required: ["section", "operation", "value"],
  },
  requiredRoles: ["student"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const section = String(args.section ?? "") as EditableSection;
    const operation = String(args.operation ?? "") as "replace" | "append";
    const value = String(args.value ?? "").trim();
    const studentId = ctx.session.id;

    if (!(EDITABLE_SECTIONS as ReadonlyArray<string>).includes(section)) {
      return { status: "error", summary: "That resume section can't be edited here." };
    }
    if (!(EDIT_OPERATIONS as ReadonlyArray<string>).includes(operation)) {
      return { status: "error", summary: "Edits can only replace or append." };
    }
    if (!value || value.length > 4000) {
      return { status: "error", summary: "The edit text is empty or too long." };
    }

    const stored = await prisma.resumeData.findUnique({
      where: { studentId },
      select: { data: true },
    });
    const resume = parseStoredResumeData(stored?.data);
    const before = section === "skills" ? resume.skills.join(", ") : resume[section];

    const toolArgs = { section, operation, value };
    const payload = {
      toolName: "propose_resume_edit",
      args: toolArgs,
      sessionId: ctx.session.id,
      conversationId: ctx.conversationId,
      targetStudentId: ctx.targetStudentId,
    };
    const now = new Date();

    if (!(ctx.confirmedToken && verifyConfirmationToken(ctx.confirmedToken, payload, now))) {
      const summary = before
        ? `Update your resume ${section}?\nNow: "${previewOf(before)}"\nProposed (${operation}): "${previewOf(value)}"`
        : `Set your resume ${section} to: "${previewOf(value)}"?`;
      await recordOperation({
        id: operationIdFor(`propose_resume_edit-${studentId}`, now),
        actorType: actorTypeFor(ctx.session.role),
        actorId: studentId,
        actorRole: ctx.session.role,
        toolName: "propose_resume_edit",
        status: "proposed",
        payload: toolArgs as never,
        resultSummary: summary,
      });
      return {
        status: "success",
        summary,
        action: {
          action: "confirm_tool",
          target: "propose_resume_edit",
          label: `Apply to ${section}`,
          meta: {
            token: createConfirmationToken(payload, now),
            toolName: "propose_resume_edit",
            args: toolArgs,
            conversationId: ctx.conversationId,
            summary,
          },
        },
        modelHint:
          "You proposed a resume edit. A review card is now shown — tell the student to read it and confirm. Do NOT call the tool again.",
      };
    }

    const operationId = operationIdFor(`propose_resume_edit-${studentId}`, now);
    try {
      const updated = resumeContentSchema.parse(applyEdit(resume, section, operation, value));
      await prisma.resumeData.upsert({
        where: { studentId },
        create: { studentId, data: JSON.stringify(updated) },
        update: { data: JSON.stringify(updated) },
      });
      const summary = `Resume ${section} updated.`;
      await recordOperation({
        id: operationId,
        actorType: actorTypeFor(ctx.session.role),
        actorId: studentId,
        actorRole: ctx.session.role,
        toolName: "propose_resume_edit",
        status: "executed",
        payload: toolArgs as never,
        resultSummary: summary,
      });
      return { status: "success", summary, data: { section } };
    } catch {
      await recordOperation({
        id: operationId,
        actorType: actorTypeFor(ctx.session.role),
        actorId: studentId,
        actorRole: ctx.session.role,
        toolName: "propose_resume_edit",
        status: "failed",
        payload: toolArgs as never,
        resultSummary: "Edit failed validation or save.",
      }).catch(() => undefined);
      return { status: "error", summary: "That edit couldn't be saved." };
    }
  },
};

/**
 * Shared read: pull a job posting + the student's resume/cert/discovery
 * profile and render grounding text. Used by analyze_job_match,
 * prepare_for_interview, and generate_cover_letter so all three reason over
 * the SAME real data instead of hallucinating.
 */
async function gatherJobAndProfile(
  jobListingId: string,
  studentId: string,
): Promise<{ job: { title: string; company: string }; grounding: string } | null> {
  const [job, stored, certs, discovery] = await Promise.all([
    prisma.jobListing.findUnique({
      where: { id: jobListingId },
      select: { id: true, title: true, company: true, location: true, description: true, salary: true, clusters: true },
    }),
    prisma.resumeData.findUnique({ where: { studentId }, select: { data: true } }),
    prisma.certification.findMany({ where: { studentId, status: "completed" }, select: { certType: true } }),
    prisma.careerDiscovery.findUnique({
      where: { studentId },
      select: { nationalClusters: true, transferableSkills: true },
    }),
  ]);
  if (!job) return null;

  const resume = parseStoredResumeData(stored?.data);
  const grounding = [
    `JOB POSTING (real text — use ONLY this):`,
    `Title: ${job.title} at ${job.company} (${job.location})${job.salary ? ` — ${job.salary}` : ""}`,
    `Clusters: ${job.clusters.join(", ") || "none tagged"}`,
    `Description: ${job.description.slice(0, 2500)}`,
    ``,
    `STUDENT PROFILE:`,
    `Resume headline: ${resume.headline || "(none)"}`,
    `Resume skills: ${resume.skills.join(", ") || "(none listed yet)"}`,
    `Experience: ${resume.experience.map((e) => `${e.title} at ${e.company}`).join("; ") || "(none listed)"}`,
    `Completed certifications: ${certs.map((cert) => cert.certType).join(", ") || "(none yet)"}`,
    `Career clusters: ${discovery?.nationalClusters ?? "(no discovery data)"}`,
    `Transferable skills: ${discovery?.transferableSkills ?? "(none recorded)"}`,
  ].join("\n");

  return { job: { title: job.title, company: job.company }, grounding };
}

const analyzeJobMatch: AgentTool = {
  name: "analyze_job_match",
  description:
    "Pull a saved or listed job's real posting details alongside the student's skills, certifications, and career clusters so you can explain how well it fits and what gaps to close. Read-only.",
  parameters: {
    type: "object",
    properties: {
      jobListingId: { type: "string", description: "The job listing's id." },
    },
    required: ["jobListingId"],
  },
  requiredRoles: ["student"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const jobListingId = String(args.jobListingId ?? "");
    const result = await gatherJobAndProfile(jobListingId, ctx.session.id);
    if (!result) return { status: "error", summary: "That job listing was not found." };

    return {
      status: "success",
      summary: `Pulled the ${result.job.title} posting and your profile for comparison.`,
      modelHint:
        result.grounding +
        "\n\nNow give the student: (1) why this job does or doesn't fit, citing the posting text; (2) the top 2-3 skill gaps; (3) one concrete next step in SPOKES (a certification, platform, or resume update) for each gap. Never invent requirements that are not in the description.",
    };
  },
};

// ─── lookup_saved_jobs — the student's pipeline ──────────────────────────────

const lookupSavedJobs: AgentTool = {
  name: "lookup_saved_jobs",
  description:
    "List the jobs the student has saved and their pipeline status. Call this to find the jobListingId for analyze_job_match, prepare_for_interview, generate_cover_letter, or update_application_status, or when the student asks about jobs they're tracking.",
  parameters: { type: "object", properties: {} },
  slashCommand: {
    command: "/myjobs",
    label: "My saved jobs",
    description: "Jobs you've saved and their status",
  },
  requiredRoles: ["student"],
  enabled: true,
  async execute(_args, ctx): Promise<AgentToolResult> {
    const studentId = ctx.session.id;
    const saved = await prisma.studentSavedJob.findMany({
      where: { studentId },
      orderBy: { savedAt: "desc" },
      take: 25,
      select: {
        status: true,
        jobListing: { select: { id: true, title: true, company: true, location: true } },
      },
    });

    if (saved.length === 0) {
      return {
        status: "success",
        summary: "You haven't saved any jobs yet.",
        data: { jobs: [] },
        action: { action: "navigate", target: "/career", label: "Browse jobs" },
        modelHint:
          "No saved jobs. Encourage the student to browse the job board and offer to help them find a fit. Don't invent jobs.",
      };
    }

    const jobs = saved.map((s) => ({
      jobListingId: s.jobListing.id,
      title: s.jobListing.title,
      company: s.jobListing.company,
      location: s.jobListing.location,
      status: s.status,
    }));

    return {
      status: "success",
      summary: `You're tracking ${jobs.length} job${jobs.length === 1 ? "" : "s"}.`,
      data: { jobs },
      modelHint:
        `Saved jobs: ${jobs
          .map((j) => `"${j.title}" at ${j.company} — ${j.status} [jobListingId=${j.jobListingId}]`)
          .join("; ")}. ` +
        "Use these jobListingIds for analyze_job_match, prepare_for_interview, generate_cover_letter, or update_application_status.",
    };
  },
};

// ─── prepare_for_interview — tailored prep grounded in the posting ──────────

const prepareForInterview: AgentTool = {
  name: "prepare_for_interview",
  description:
    "Get interview-prep material for a specific job, grounded in the real posting and the student's profile. Use the jobListingId from lookup_saved_jobs. Read-only.",
  parameters: {
    type: "object",
    properties: {
      jobListingId: { type: "string", description: "The job listing's id." },
    },
    required: ["jobListingId"],
  },
  requiredRoles: ["student"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const jobListingId = String(args.jobListingId ?? "");
    const result = await gatherJobAndProfile(jobListingId, ctx.session.id);
    if (!result) return { status: "error", summary: "That job listing was not found." };

    return {
      status: "success",
      summary: `Pulled the ${result.job.title} posting to build interview prep.`,
      modelHint:
        result.grounding +
        "\n\nNow coach the student for this interview in plain, encouraging language: " +
        "(1) 5-6 likely interview questions tailored to THIS role, including 1-2 behavioral ones they can answer from their experience/certs above; " +
        "(2) 2-3 strong questions for them to ask the employer; " +
        "(3) 3 quick prep tips (what to research, what to bring, logistics like arriving early/dress). " +
        "Keep it concrete to this job and this student — don't give generic advice that ignores the posting.",
    };
  },
};

// ─── generate_cover_letter — grounded draft the student can use ─────────────

const generateCoverLetter: AgentTool = {
  name: "generate_cover_letter",
  description:
    "Draft a tailored cover letter for a specific job, grounded in the real posting and the student's resume/certs. Use the jobListingId from lookup_saved_jobs. The draft appears in chat for the student to copy and edit. Read-only.",
  parameters: {
    type: "object",
    properties: {
      jobListingId: { type: "string", description: "The job listing's id." },
    },
    required: ["jobListingId"],
  },
  requiredRoles: ["student"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const jobListingId = String(args.jobListingId ?? "");
    const result = await gatherJobAndProfile(jobListingId, ctx.session.id);
    if (!result) return { status: "error", summary: "That job listing was not found." };

    return {
      status: "success",
      summary: `Drafting a cover letter for ${result.job.title} at ${result.job.company}.`,
      modelHint:
        result.grounding +
        "\n\nNow write a complete, ready-to-send cover letter for this student and THIS job. " +
        "3-4 short paragraphs at a 6th-8th grade reading level: an opening naming the role and company; " +
        "a middle that ties the student's REAL skills, experience, and completed certifications above to what the posting asks for; " +
        "and a brief, confident closing. Use a warm, professional voice. " +
        "Do NOT invent experience, skills, or credentials the student doesn't have. " +
        "If a key field (like their name or contact info) is missing, use a clear placeholder like [Your Name] and tell them to fill it in. " +
        "After the letter, remind them to review and personalize it before sending.",
    };
  },
};

export const CAREER_TOOLS: AgentTool[] = [
  proposeResumeEdit,
  analyzeJobMatch,
  lookupSavedJobs,
  prepareForInterview,
  generateCoverLetter,
];
