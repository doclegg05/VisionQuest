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
    const studentId = ctx.session.id;

    const [job, stored, certs, discovery] = await Promise.all([
      prisma.jobListing.findUnique({
        where: { id: jobListingId },
        select: { id: true, title: true, company: true, location: true, description: true, salary: true, clusters: true },
      }),
      prisma.resumeData.findUnique({ where: { studentId }, select: { data: true } }),
      prisma.certification.findMany({
        where: { studentId, status: "completed" },
        select: { certType: true },
      }),
      prisma.careerDiscovery.findUnique({
        where: { studentId },
        select: { nationalClusters: true, transferableSkills: true },
      }),
    ]);
    if (!job) return { status: "error", summary: "That job listing was not found." };

    const resume = parseStoredResumeData(stored?.data);
    const grounding = [
      `JOB POSTING (real text — analyze ONLY against this):`,
      `Title: ${job.title} at ${job.company} (${job.location})${job.salary ? ` — ${job.salary}` : ""}`,
      `Clusters: ${job.clusters.join(", ") || "none tagged"}`,
      `Description: ${job.description.slice(0, 2500)}`,
      ``,
      `STUDENT PROFILE:`,
      `Resume skills: ${resume.skills.join(", ") || "(none listed yet)"}`,
      `Completed certifications: ${certs.map((cert) => cert.certType).join(", ") || "(none yet)"}`,
      `Career clusters: ${discovery?.nationalClusters ?? "(no discovery data)"}`,
      `Transferable skills: ${discovery?.transferableSkills ?? "(none recorded)"}`,
    ].join("\n");

    return {
      status: "success",
      summary: `Pulled the ${job.title} posting and your profile for comparison.`,
      modelHint:
        grounding +
        "\n\nNow give the student: (1) why this job does or doesn't fit, citing the posting text; (2) the top 2-3 skill gaps; (3) one concrete next step in SPOKES (a certification, platform, or resume update) for each gap. Never invent requirements that are not in the description.",
    };
  },
};

export const CAREER_TOOLS: AgentTool[] = [proposeResumeEdit, analyzeJobMatch];
