/**
 * Sage write tools (Phase 3).
 *
 * Contract every tool here follows:
 * 1. Ownership: students act only on their own rows (where: studentId).
 * 2. Confirmation: consequential actions require a confirm card round-trip —
 *    the unconfirmed call returns a proposal with an HMAC token
 *    (see confirmation.ts); only /api/chat/tool-confirm sets ctx flag
 *    `confirmedToken`, and the token must verify against THIS exact call.
 * 3. Ledger + audit: every proposal and execution is recorded via
 *    recordOperation() — sage_tool.<name>.<status> in the AuditLog.
 *
 * Trivially-reversible tools (save_job, add_portfolio_item) skip the
 * confirmation round-trip but still ledger.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listBookableAdvisors, sendAppointmentConfirmation, syncStudentAlerts } from "@/lib/advising";
import { formatCohortDateTime } from "@/lib/timezone";
import { markRequirementComplete } from "../cert-actions";
import { operationIdFor, recordOperation, type OperationActorType } from "../operations";
import { createConfirmationToken, verifyConfirmationToken } from "./confirmation";
import type { AgentTool, AgentToolContext, AgentToolResult } from "./types";

const GOAL_STATUS_TRANSITIONS = ["active", "paused", "completed"] as const;

function actorTypeFor(role: string): OperationActorType {
  if (role === "teacher") return "teacher";
  if (role === "admin") return "admin";
  return "student";
}

/**
 * Confirmation gate shared by consequential tools. Returns null when the
 * call is confirmed (proceed); otherwise returns the proposal result.
 */
async function confirmationGate(
  toolName: string,
  args: Record<string, unknown>,
  ctx: AgentToolContext,
  proposalSummary: string,
  confirmLabel: string,
): Promise<AgentToolResult | null> {
  const token = ctx.confirmedToken;
  const payload = {
    toolName,
    args,
    sessionId: ctx.session.id,
    conversationId: ctx.conversationId,
    targetStudentId: ctx.targetStudentId,
  };

  if (token && verifyConfirmationToken(token, payload, new Date())) {
    return null; // confirmed — caller proceeds with execution
  }

  const now = new Date();
  const proposalToken = createConfirmationToken(payload, now);
  await recordOperation({
    id: operationIdFor(`${toolName}-${ctx.session.id}`, now),
    actorType: actorTypeFor(ctx.session.role),
    actorId: ctx.session.id,
    actorRole: ctx.session.role,
    toolName,
    status: "proposed",
    payload: args as never,
    resultSummary: proposalSummary,
  });

  return {
    status: "success",
    summary: proposalSummary,
    action: {
      action: "confirm_tool",
      target: toolName,
      label: confirmLabel,
      meta: { token: proposalToken, toolName, args, conversationId: ctx.conversationId, summary: proposalSummary, targetStudentId: ctx.targetStudentId },
    },
    modelHint:
      `You proposed ${toolName}. A confirmation card is now shown to the user. ` +
      "Do NOT call the tool again — tell the user to review and confirm the card.",
  };
}

async function executeAndLedger(
  toolName: string,
  args: Record<string, unknown>,
  ctx: AgentToolContext,
  work: () => Promise<{ summary: string; data?: unknown }>,
): Promise<AgentToolResult> {
  const now = new Date();
  const operationId = operationIdFor(`${toolName}-${ctx.session.id}`, now);
  try {
    const { summary, data } = await work();
    await recordOperation({
      id: operationId,
      actorType: actorTypeFor(ctx.session.role),
      actorId: ctx.session.id,
      actorRole: ctx.session.role,
      toolName,
      status: "executed",
      payload: args as never,
      resultSummary: summary,
    });
    return { status: "success", summary, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Write tool ${toolName} failed`, { error: message });
    await recordOperation({
      id: operationId,
      actorType: actorTypeFor(ctx.session.role),
      actorId: ctx.session.id,
      actorRole: ctx.session.role,
      toolName,
      status: "failed",
      payload: args as never,
      resultSummary: message,
    }).catch(() => undefined);
    return { status: "error", summary: "That didn't work — the action was not completed." };
  }
}

// ─── submit_form — the orientation golden path ──────────────────────────────

const submitForm: AgentTool = {
  name: "submit_form",
  description:
    "File a signed form the student uploaded in chat against one of their orientation checklist items, marking that item complete. Requires user confirmation.",
  parameters: {
    type: "object",
    properties: {
      fileUploadId: { type: "string", description: "The uploaded file's fileUploadId from the attached-files context." },
      orientationItemId: { type: "string", description: "The orientation checklist item this signed form satisfies." },
    },
    required: ["fileUploadId", "orientationItemId"],
  },
  requiredRoles: ["student", "teacher", "admin"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const fileUploadId = String(args.fileUploadId ?? "");
    const orientationItemId = String(args.orientationItemId ?? "");
    const studentId = ctx.targetStudentId ?? ctx.session.id;

    // Validate referents up front so the proposal card names real things.
    const [file, item] = await Promise.all([
      prisma.fileUpload.findFirst({
        where: { id: fileUploadId, studentId },
        select: { id: true, filename: true },
      }),
      prisma.orientationItem.findUnique({
        where: { id: orientationItemId },
        select: { id: true, label: true },
      }),
    ]);
    if (!file) return { status: "error", summary: "That uploaded file was not found on this account." };
    if (!item) return { status: "error", summary: "That orientation item was not found." };

    const gate = await confirmationGate(
      "submit_form",
      { fileUploadId, orientationItemId },
      ctx,
      `File "${file.filename}" as the signed form for orientation item "${item.label}"?`,
      `Submit "${file.filename}"`,
    );
    if (gate) return gate;

    return executeAndLedger("submit_form", { fileUploadId, orientationItemId }, ctx, async () => {
      await prisma.$transaction([
        prisma.orientationProgress.upsert({
          where: { studentId_itemId: { studentId, itemId: orientationItemId } },
          create: { studentId, itemId: orientationItemId, completed: true, completedAt: new Date() },
          update: { completed: true, completedAt: new Date() },
        }),
        prisma.fileUpload.update({
          where: { id: fileUploadId },
          data: { category: "orientation_form" },
        }),
      ]);
      return {
        summary: `Done — "${file.filename}" is filed and "${item.label}" is marked complete.`,
        data: { orientationItemId, fileUploadId },
      };
    });
  },
};

// ─── file_document — categorize an uploaded file ────────────────────────────

const FILE_CATEGORIES = ["general", "resume", "portfolio", "cert_evidence", "orientation_form"] as const;

const fileDocument: AgentTool = {
  name: "file_document",
  description:
    "File an uploaded chat document into the right place: a document category, or as evidence for a certification requirement. Requires user confirmation.",
  parameters: {
    type: "object",
    properties: {
      fileUploadId: { type: "string", description: "The uploaded file's fileUploadId." },
      category: {
        type: "string",
        enum: FILE_CATEGORIES,
        description: "Where the document belongs.",
      },
      certRequirementTemplateId: {
        type: "string",
        description: "Only with category cert_evidence: the certification requirement template this file evidences.",
      },
    },
    required: ["fileUploadId", "category"],
  },
  requiredRoles: ["student", "teacher", "admin"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const fileUploadId = String(args.fileUploadId ?? "");
    const category = String(args.category ?? "");
    const templateId = args.certRequirementTemplateId
      ? String(args.certRequirementTemplateId)
      : undefined;
    const studentId = ctx.targetStudentId ?? ctx.session.id;

    if (!(FILE_CATEGORIES as ReadonlyArray<string>).includes(category)) {
      return { status: "error", summary: "That isn't a valid document category." };
    }
    const file = await prisma.fileUpload.findFirst({
      where: { id: fileUploadId, studentId },
      select: { id: true, filename: true },
    });
    if (!file) return { status: "error", summary: "That uploaded file was not found on this account." };

    const gateArgs: Record<string, unknown> = templateId
      ? { fileUploadId, category, certRequirementTemplateId: templateId }
      : { fileUploadId, category };
    const gate = await confirmationGate(
      "file_document",
      gateArgs,
      ctx,
      category === "cert_evidence"
        ? `Attach "${file.filename}" as certification evidence?`
        : `File "${file.filename}" under ${category.replace("_", " ")}?`,
      `File "${file.filename}"`,
    );
    if (gate) return gate;

    return executeAndLedger("file_document", gateArgs, ctx, async () => {
      await prisma.fileUpload.update({ where: { id: fileUploadId }, data: { category } });

      if (category === "cert_evidence" && templateId) {
        const cert = await prisma.certification.findFirst({
          where: { studentId },
          select: { id: true },
        });
        if (cert) {
          // Attach evidence only — completion/verification stays with the teacher.
          await prisma.certRequirement.updateMany({
            where: { certificationId: cert.id, templateId },
            data: { fileId: fileUploadId },
          });
        }
      }
      return { summary: `Filed "${file.filename}" under ${category.replace("_", " ")}.` };
    });
  },
};

// ─── update_goal_status ──────────────────────────────────────────────────────

const updateGoalStatus: AgentTool = {
  name: "update_goal_status",
  description:
    "Update the status of one of the student's goals (active, paused, or completed). Requires user confirmation.",
  parameters: {
    type: "object",
    properties: {
      goalId: { type: "string", description: "The goal's id." },
      status: { type: "string", enum: GOAL_STATUS_TRANSITIONS, description: "The new status." },
    },
    required: ["goalId", "status"],
  },
  requiredRoles: ["student", "teacher", "admin"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const goalId = String(args.goalId ?? "");
    const status = String(args.status ?? "");
    const studentId = ctx.targetStudentId ?? ctx.session.id;

    if (!(GOAL_STATUS_TRANSITIONS as ReadonlyArray<string>).includes(status)) {
      return { status: "error", summary: "Goals can only be set to active, paused, or completed here." };
    }
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, studentId },
      select: { id: true, content: true, status: true },
    });
    if (!goal) return { status: "error", summary: "That goal was not found on this account." };

    const gate = await confirmationGate(
      "update_goal_status",
      { goalId, status },
      ctx,
      `Mark the goal "${goal.content.slice(0, 80)}" as ${status}?`,
      `Mark ${status}`,
    );
    if (gate) return gate;

    return executeAndLedger("update_goal_status", { goalId, status }, ctx, async () => {
      await prisma.goal.update({ where: { id: goalId }, data: { status } });
      return { summary: `Goal updated to ${status}.`, data: { goalId, status } };
    });
  },
};

// ─── save_job (no confirmation — trivially reversible) ──────────────────────

const saveJob: AgentTool = {
  name: "save_job",
  description: "Save a job listing to the student's saved jobs list.",
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

    const listing = await prisma.jobListing.findUnique({
      where: { id: jobListingId },
      select: { id: true, title: true, company: true },
    });
    if (!listing) return { status: "error", summary: "That job listing was not found." };

    return executeAndLedger("save_job", { jobListingId }, ctx, async () => {
      await prisma.studentSavedJob.upsert({
        where: { studentId_jobListingId: { studentId, jobListingId } },
        create: { studentId, jobListingId },
        update: {},
      });
      return { summary: `Saved "${listing.title}" at ${listing.company} to your jobs list.` };
    });
  },
};

// ─── add_portfolio_item (no confirmation — trivially reversible) ────────────

const addPortfolioItem: AgentTool = {
  name: "add_portfolio_item",
  description:
    "Add an item to the student's portfolio — optionally linking a file they uploaded in chat.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short item title." },
      description: { type: "string", description: "Optional description." },
      fileUploadId: { type: "string", description: "Optional uploaded file to attach." },
    },
    required: ["title"],
  },
  requiredRoles: ["student"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const title = String(args.title ?? "").trim().slice(0, 200);
    const description = args.description ? String(args.description).slice(0, 2000) : null;
    const fileUploadId = args.fileUploadId ? String(args.fileUploadId) : null;
    const studentId = ctx.session.id;

    if (!title) return { status: "error", summary: "The portfolio item needs a title." };
    if (fileUploadId) {
      const file = await prisma.fileUpload.findFirst({
        where: { id: fileUploadId, studentId },
        select: { id: true },
      });
      if (!file) return { status: "error", summary: "That uploaded file was not found on this account." };
    }

    return executeAndLedger(
      "add_portfolio_item",
      { title, description, fileUploadId },
      ctx,
      async () => {
        await prisma.portfolioItem.create({
          data: { studentId, title, description, fileId: fileUploadId },
        });
        return { summary: `Added "${title}" to your portfolio.` };
      },
    );
  },
};

// ─── book_appointment — schedule an advising slot ───────────────────────────

const bookAppointment: AgentTool = {
  name: "book_appointment",
  description:
    "Book an advising slot the student picked from find_appointment_slots. Pass the exact advisorId and startsAt from that slot. Requires user confirmation.",
  parameters: {
    type: "object",
    properties: {
      advisorId: { type: "string", description: "The advisor's id from the chosen slot." },
      startsAt: { type: "string", description: "The chosen slot's exact startsAt ISO timestamp." },
    },
    required: ["advisorId", "startsAt"],
  },
  // Self-booking only — the backend (/api/appointments/book) is student-scoped.
  requiredRoles: ["student"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const advisorId = String(args.advisorId ?? "");
    const startsAt = String(args.startsAt ?? "");
    if (!advisorId || !startsAt) {
      return { status: "error", summary: "I need both the advisor and the exact time to book." };
    }

    // Re-validate the slot against live availability (mirrors the API route)
    // so a stale pick fails cleanly instead of double-booking.
    const advisors = await listBookableAdvisors({
      days: 21,
      maxSlotsPerAdvisor: 100,
      minimumLeadMinutes: 60,
    });
    const advisor = advisors.find((entry) => entry.advisorId === advisorId);
    const slot = advisor?.slots.find((entry) => entry.startsAt === startsAt);
    if (!advisor || !slot) {
      return {
        status: "error",
        summary: "That time slot is no longer available.",
        modelHint:
          "The chosen slot is gone. Call find_appointment_slots again to get fresh times, then offer those.",
      };
    }

    const when = formatCohortDateTime(slot.startsAt);
    const gate = await confirmationGate(
      "book_appointment",
      { advisorId, startsAt },
      ctx,
      `Book an advising session with ${advisor.advisorName} on ${when}?`,
      `Book ${when}`,
    );
    if (gate) return gate;

    return executeAndLedger("book_appointment", { advisorId, startsAt }, ctx, async () => {
      const appointment = await prisma.appointment.create({
        data: {
          studentId: ctx.session.id,
          advisorId,
          title: "Advising session",
          startsAt: new Date(slot.startsAt),
          endsAt: new Date(slot.endsAt),
          locationType: slot.locationType,
          locationLabel: slot.locationLabel,
          meetingUrl: slot.meetingUrl,
          bookingSource: "student",
          status: "scheduled",
        },
        select: { id: true },
      });

      await syncStudentAlerts(ctx.session.id);
      try {
        await sendAppointmentConfirmation(appointment.id);
      } catch (error) {
        logger.error("book_appointment: confirmation send failed", { error: String(error) });
      }

      return {
        summary: `Booked — you're set with ${advisor.advisorName} on ${when}.`,
        data: { appointmentId: appointment.id, advisorId, startsAt: slot.startsAt },
      };
    });
  },
};

// ─── mark_certification_complete — self-report a Ready-to-Work item ─────────

const markCertificationComplete: AgentTool = {
  name: "mark_certification_complete",
  description:
    "Mark one of the student's Ready-to-Work certification requirements complete (self-report). Use the requirementId from lookup_cert_progress. Optionally attach an uploaded file as evidence. Requires user confirmation.",
  parameters: {
    type: "object",
    properties: {
      requirementId: { type: "string", description: "The requirement's id from lookup_cert_progress." },
      fileId: { type: "string", description: "Optional uploaded fileUploadId to attach as evidence." },
    },
    required: ["requirementId"],
  },
  // Self-report only — mirrors the student-scoped POST /api/certifications.
  requiredRoles: ["student"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const requirementId = String(args.requirementId ?? "");
    const fileId = args.fileId ? String(args.fileId) : undefined;
    const studentId = ctx.session.id;
    if (!requirementId) {
      return { status: "error", summary: "I need to know which certification item to mark." };
    }

    // Validate ownership + name the item before proposing, so the confirm card
    // references a real requirement (mirrors submit_form's upfront check).
    const requirement = await prisma.certRequirement.findFirst({
      where: { id: requirementId, certification: { studentId } },
      select: { id: true, template: { select: { label: true, needsFile: true } } },
    });
    if (!requirement) {
      return { status: "error", summary: "That certification item wasn't found on your account." };
    }
    if (requirement.template.needsFile && !fileId) {
      // Surfaced before the confirm card so the student knows what's needed.
      const file = await prisma.certRequirement.findFirst({
        where: { id: requirementId },
        select: { fileId: true },
      });
      if (!file?.fileId) {
        return {
          status: "error",
          summary: `"${requirement.template.label}" needs a file attached before it can be marked complete. Ask the student to upload it, then attach it here.`,
        };
      }
    }

    const gateArgs: Record<string, unknown> = fileId ? { requirementId, fileId } : { requirementId };
    const gate = await confirmationGate(
      "mark_certification_complete",
      gateArgs,
      ctx,
      `Mark "${requirement.template.label}" complete on your Ready-to-Work certification?`,
      `Mark "${requirement.template.label}" done`,
    );
    if (gate) return gate;

    return executeAndLedger("mark_certification_complete", gateArgs, ctx, async () => {
      const result = await markRequirementComplete({ studentId, requirementId, fileId });
      if (!result.ok) {
        // Surface the domain reason (e.g. needs a file) as a thrown error so
        // executeAndLedger records a failed op and returns a clean message.
        throw new Error(result.reason);
      }
      const notes: string[] = [];
      if (result.certCompleted) notes.push("That finishes your Ready-to-Work certification — nice work!");
      if (result.awaitingVerification) notes.push("Your instructor still needs to verify this one.");
      return {
        summary: `Marked "${result.label}" complete.${notes.length ? " " + notes.join(" ") : ""}`,
        data: { requirementId, certCompleted: result.certCompleted, awaitingVerification: result.awaitingVerification },
      };
    });
  },
};

export const WRITE_TOOLS: AgentTool[] = [
  submitForm,
  fileDocument,
  updateGoalStatus,
  saveJob,
  addPortfolioItem,
  bookAppointment,
  markCertificationComplete,
];
