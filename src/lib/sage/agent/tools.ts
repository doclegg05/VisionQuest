// =============================================================================
// Sage Agent — Phase 1 Tool Definitions
//
// All tools are read-only or low-risk. Each declares Gemini-compatible
// `parameters` plus a server-side `execute` handler. Slash commands are
// optional metadata that surface the tool in the UI's slash menu.
//
// Phase 2+ (write actions like mark_certification_complete, book_appointment,
// update_goal_status) is intentionally NOT included here. Those require the
// confirmation UX patterns that don't yet exist on the chat surface.
// =============================================================================

import { prisma } from "@/lib/db";
import { FORMS, buildFormDownloadUrl } from "@/lib/spokes/forms";
import { TOPIC_CONTENT } from "@/lib/sage/knowledge-base";
import { logger } from "@/lib/logger";
import type { AgentTool, AgentToolResult } from "./types";

const PROGRAM_INFO_TOPICS = Object.keys(TOPIC_CONTENT) as ReadonlyArray<string>;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function scoreMatch(query: string, candidate: string): number {
  const q = tokenize(query);
  const c = tokenize(candidate);
  if (q.length === 0 || c.length === 0) return 0;
  const cSet = new Set(c);
  return q.reduce((acc, token) => acc + (cSet.has(token) ? 1 : 0), 0) / q.length;
}

// -----------------------------------------------------------------------------
// present_form
// -----------------------------------------------------------------------------

const presentForm: AgentTool = {
  name: "present_form",
  description:
    "Pull up a SPOKES program form by id or fuzzy name match. Returns a button card the student can click to open the PDF in a new tab.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The form id (e.g. 'spokes-student-profile') or a natural-language name (e.g. 'student profile', 'attendance contract').",
      },
    },
    required: ["query"],
  },
  slashCommand: {
    command: "/form",
    label: "Open a form",
    description: "Pull up any program form by name",
    argHint: "form name or id",
    parseArgs: (raw) => ({ query: raw.trim() }),
  },
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  enabled: true,
  async execute(args): Promise<AgentToolResult> {
    const query = String(args.query ?? "").trim();
    if (!query) {
      return { status: "error", summary: "I need a form name or id to look up." };
    }

    const exact = FORMS.find(
      (form) => form.id === query || form.title.toLowerCase() === query.toLowerCase(),
    );
    const match =
      exact ??
      FORMS
        .map((form) => ({ form, score: scoreMatch(query, `${form.title} ${form.description}`) }))
        .filter((entry) => entry.score > 0.3)
        .sort((a, b) => b.score - a.score)[0]?.form;

    if (!match) {
      return {
        status: "error",
        summary: `I couldn't find a form matching "${query}". Try the form name from your onboarding packet.`,
      };
    }

    return {
      status: "success",
      summary: `Found "${match.title}".`,
      data: {
        formId: match.id,
        title: match.title,
        description: match.description,
        category: match.category,
        fillable: match.fillable,
      },
      action: {
        action: "open_form",
        // The PDF download endpoint — /forms/<id> is the Forms Hub fill UI
        // keyed by DB FormTemplate ids, where catalog slugs 404.
        target: buildFormDownloadUrl(match.id, "view"),
        label: `Open ${match.title}`,
      },
      modelHint: `Surfaced form "${match.title}" (${match.category}). The student now has a button to open it. Briefly tell them what the form is for and any next step.`,
    };
  },
};

// -----------------------------------------------------------------------------
// find_certification
// -----------------------------------------------------------------------------

const findCertification: AgentTool = {
  name: "find_certification",
  description:
    "Search the SPOKES certification catalog. Returns up to 5 matches with category and required-flag metadata.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A keyword or partial name (e.g. 'quickbooks', 'photoshop', 'cybersecurity').",
      },
      limit: {
        type: "integer",
        description: "Max number of matches to return (default 5).",
      },
    },
    required: ["query"],
  },
  slashCommand: {
    command: "/cert",
    label: "Find a certification",
    description: "Search the certification catalog",
    argHint: "cert name",
    parseArgs: (raw) => ({ query: raw.trim() }),
  },
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  enabled: true,
  async execute(args): Promise<AgentToolResult> {
    const query = String(args.query ?? "").trim();
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
    if (!query) {
      return { status: "error", summary: "Give me a keyword to search the cert catalog." };
    }

    const all = await prisma.spokesModuleTemplate.findMany({
      where: { active: true },
      select: { id: true, label: true, description: true, category: true, required: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });

    const ranked = all
      .map((cert) => ({
        cert,
        score: Math.max(
          scoreMatch(query, cert.label),
          0.5 * scoreMatch(query, cert.description ?? ""),
        ),
      }))
      .filter((entry) => entry.score > 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (ranked.length === 0) {
      return {
        status: "success",
        summary: `No certifications matched "${query}".`,
        data: { matches: [] },
        modelHint: `No catalog matches for "${query}". Tell the student plainly and offer to broaden the search.`,
      };
    }

    return {
      status: "success",
      summary: `Found ${ranked.length} certification${ranked.length === 1 ? "" : "s"} matching "${query}".`,
      data: {
        matches: ranked.map((entry) => ({
          id: entry.cert.id,
          label: entry.cert.label,
          description: entry.cert.description,
          category: entry.cert.category,
          required: entry.cert.required,
        })),
      },
      modelHint: `Top matches: ${ranked.map((r) => r.cert.label).join(", ")}. Pick the most relevant for the student and explain it briefly.`,
    };
  },
};

// -----------------------------------------------------------------------------
// lookup_appointment
// -----------------------------------------------------------------------------

const lookupAppointment: AgentTool = {
  name: "lookup_appointment",
  description:
    "Return upcoming appointments for the current student (or the staff-targeted student) within a window.",
  parameters: {
    type: "object",
    properties: {
      withinDays: {
        type: "integer",
        description: "Look-ahead window in days (default 14, max 90).",
      },
    },
  },
  slashCommand: {
    command: "/appointments",
    label: "Show my appointments",
    description: "Upcoming check-ins on your schedule",
  },
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const studentId = ctx.targetStudentId ?? ctx.session.id;
    if (!studentId) {
      return { status: "error", summary: "I don't have a student in context to look up appointments." };
    }
    const days = Math.min(Math.max(Number(args.withinDays) || 14, 1), 90);
    const now = new Date();
    const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
      where: {
        studentId,
        startsAt: { gte: now, lte: horizon },
        status: { in: ["scheduled", "confirmed"] },
      },
      orderBy: { startsAt: "asc" },
      take: 10,
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        locationType: true,
        locationLabel: true,
      },
    });

    if (appointments.length === 0) {
      return {
        status: "success",
        summary: `No appointments in the next ${days} days.`,
        data: { appointments: [] },
        modelHint: `Student has nothing scheduled in the window. Offer to help them book one if relevant.`,
      };
    }

    return {
      status: "success",
      summary: `${appointments.length} appointment${appointments.length === 1 ? "" : "s"} in the next ${days} days.`,
      data: {
        appointments: appointments.map((appt) => ({
          id: appt.id,
          title: appt.title,
          description: appt.description,
          startsAt: appt.startsAt.toISOString(),
          endsAt: appt.endsAt.toISOString(),
          locationType: appt.locationType,
          locationLabel: appt.locationLabel,
        })),
      },
      action: {
        action: "navigate",
        target: "/appointments",
        label: "View all appointments",
      },
      modelHint: `Upcoming: ${appointments
        .map((a) => `${a.title} @ ${a.startsAt.toLocaleString()}`)
        .join("; ")}. Mention the next one specifically.`,
    };
  },
};

// -----------------------------------------------------------------------------
// open_resource
// -----------------------------------------------------------------------------

const STATIC_RESOURCES: Record<string, { label: string; href: string; summary: string }> = {
  "dress-code": {
    label: "Dress Code",
    href: "/resources",
    summary: "SPOKES dress-code policy and acknowledgment.",
  },
  "attendance-policy": {
    label: "Attendance Policy",
    href: "/resources",
    summary: "Attendance expectations, lateness, and absence reporting.",
  },
  "student-handbook": {
    label: "Student Handbook",
    href: "/resources",
    summary: "Full student handbook with policies and resources.",
  },
  "career-discovery": {
    label: "Career Discovery",
    href: "/career",
    summary: "Career discovery questionnaire and pathway recommendations.",
  },
  "vision-board": {
    label: "Vision Board",
    href: "/vision-board",
    summary: "Your goal vision board.",
  },
  goals: {
    label: "Goals",
    href: "/goals",
    summary: "Your active goals and BHAG.",
  },
  portfolio: {
    label: "Portfolio",
    href: "/portfolio",
    summary: "Your employment portfolio (resume, references, samples).",
  },
};

const openResource: AgentTool = {
  name: "open_resource",
  description:
    "Open a known program resource (dress code, attendance policy, handbook, career discovery, vision board, goals, portfolio).",
  parameters: {
    type: "object",
    properties: {
      resourceId: {
        type: "string",
        description: "One of: dress-code, attendance-policy, student-handbook, career-discovery, vision-board, goals, portfolio.",
        enum: Object.keys(STATIC_RESOURCES),
      },
    },
    required: ["resourceId"],
  },
  slashCommand: {
    command: "/open",
    label: "Open a resource",
    description: "Pull up a program resource by name",
    argHint: "dress-code | attendance-policy | handbook | career-discovery | vision-board | goals | portfolio",
    parseArgs: (raw) => ({ resourceId: raw.trim() }),
  },
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  enabled: true,
  async execute(args): Promise<AgentToolResult> {
    const resourceId = String(args.resourceId ?? "").trim();
    const resource = STATIC_RESOURCES[resourceId];
    if (!resource) {
      return {
        status: "error",
        summary: `I don't know a resource called "${resourceId}".`,
      };
    }
    return {
      status: "success",
      summary: `Found "${resource.label}".`,
      action: {
        action: "open_resource",
        target: resource.href,
        label: `Open ${resource.label}`,
      },
      modelHint: `Resource "${resource.label}" — ${resource.summary}. Tell the student briefly what's there.`,
    };
  },
};

// -----------------------------------------------------------------------------
// lookup_program_info
// -----------------------------------------------------------------------------

const lookupProgramInfo: AgentTool = {
  name: "lookup_program_info",
  description:
    "Retrieve detailed program knowledge for a specific topic on demand. Call this when you need specifics that aren't in your brief overview — certification details, platform setup steps, onboarding requirements, etc.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description:
          "The topic key. Pick from the available list shown in your system prompt.",
        enum: PROGRAM_INFO_TOPICS,
      },
    },
    required: ["topic"],
  },
  // No slash command — this is model-driven, not user-invoked.
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  enabled: true,
  async execute(args): Promise<AgentToolResult> {
    const topic = String(args.topic ?? "").trim();
    const content = TOPIC_CONTENT[topic];
    if (!content) {
      return {
        status: "error",
        summary: `Unknown program topic "${topic}". Pick one from the available list.`,
        modelHint: `Available topics: ${PROGRAM_INFO_TOPICS.join(", ")}.`,
      };
    }
    return {
      status: "success",
      summary: `Loaded program details for "${topic}".`,
      data: { topic, content },
      modelHint: content,
    };
  },
};

// -----------------------------------------------------------------------------
// classify_attachment
// -----------------------------------------------------------------------------

const classifyAttachment: AgentTool = {
  name: "classify_attachment",
  description:
    "Inspect an uploaded attachment (image or PDF) and identify what it is — certificate, form, receipt, etc. Returns the detected kind plus extracted fields like cert name and date earned.",
  parameters: {
    type: "object",
    properties: {
      attachmentId: {
        type: "string",
        description: "The attachment id from the most recent attachment_ack event.",
      },
    },
    required: ["attachmentId"],
  },
  // No slash command — this is invoked automatically when an attachment arrives.
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  enabled: false, // Phase 1.5 — requires multimodal pipeline; keep disabled until vision wired.
  async execute(args, ctx): Promise<AgentToolResult> {
    const attachmentId = String(args.attachmentId ?? "").trim();
    logger.info("classify_attachment invoked (stub)", {
      attachmentId,
      studentId: ctx.session.id,
    });
    return {
      status: "error",
      summary: "Attachment classification isn't ready yet — Sage's multimodal pipeline is still being wired up.",
    };
  },
};

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

import { WRITE_TOOLS } from "./write-tools";
import { CAREER_TOOLS } from "./career-tools";

const ALL_TOOLS: AgentTool[] = [
  presentForm,
  findCertification,
  lookupAppointment,
  openResource,
  lookupProgramInfo,
  classifyAttachment,
  ...WRITE_TOOLS,
  ...CAREER_TOOLS,
];

export function getEnabledTools(role: string): AgentTool[] {
  return ALL_TOOLS.filter(
    (tool) =>
      tool.enabled &&
      tool.requiredRoles.some((allowed) => allowed === role || (role === "admin" && allowed !== "student")),
  );
}

export function getToolByName(name: string): AgentTool | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name);
}

export function getSlashCommandsForRole(role: string) {
  return getEnabledTools(role)
    .filter((tool) => tool.slashCommand)
    .map((tool) => ({
      name: tool.slashCommand!.command,
      label: tool.slashCommand!.label,
      description: tool.slashCommand!.description,
      argHint: tool.slashCommand!.argHint,
      requiresArg: Boolean(tool.parameters.required && tool.parameters.required.length > 0),
      tool: tool.name,
    }));
}

export function findToolBySlashCommand(command: string): AgentTool | undefined {
  return ALL_TOOLS.find(
    (tool) => tool.slashCommand?.command === command || tool.slashCommand?.command === `/${command.replace(/^\//, "")}`,
  );
}
