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
      meta: { token: proposalToken, toolName, args, conversationId: ctx.conversationId },
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

export const WRITE_TOOLS: AgentTool[] = [
  submitForm,
  fileDocument,
  updateGoalStatus,
  saveJob,
  addPortfolioItem,
];
