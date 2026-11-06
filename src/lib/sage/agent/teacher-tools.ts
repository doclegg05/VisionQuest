/**
 * Assistant-teacher tools (Pillar 5).
 *
 * The awareness pillars give Sage a deep picture of each student; this turns
 * that into a staff superpower: a teacher can ask "who needs attention this
 * week?" and Sage answers from the real, urgency-scored intervention queue —
 * the same data the teacher dashboard ranks — scoped to the students that
 * staff member actually manages.
 *
 * Read-only. Teacher/admin/coordinator only; coordinators get counts, never
 * alert content. Per-student deep dives already
 * arrive via staff-student-context when a teacher names a student.
 */

import { isCoordinatorRole } from "@/lib/org-roles";
import type { InterventionQueueEntry } from "@/lib/teacher/intervention-queue";
import type { AgentTool, AgentToolResult } from "./types";

// NOTE: @/lib/teacher/dashboard pulls in `server-only`, which throws if loaded
// outside a server runtime (e.g. the node test runner collecting the tool
// registry). Import it LAZILY inside execute so the registry stays importable
// in tests and client bundles; it only loads when the tool actually runs.

type QueueEntry = InterventionQueueEntry;

/**
 * Coordinators get a name and a count of open items (alerts, overdue tasks,
 * stalled goals) per student. No alert title, type, severity or reason text:
 * coordinators never see alert content, and the RLS layer agrees.
 */
function coordinatorAttentionResult(top: QueueEntry[]): AgentToolResult {
  const students = top.map((s) => ({
    name: s.name,
    openItemCount: s.signals.openAlertCount + s.signals.overdueTaskCount + s.signals.stalledGoalCount,
  }));
  return {
    status: "success",
    summary: `${top.length} student${top.length === 1 ? "" : "s"} have open items.`,
    data: { students },
    action: { action: "navigate", target: "/coordinator", label: "Open coordinator view" },
    modelHint:
      `Students with open items, most urgent first: ${students
        .map((s) => `${s.name} (${s.openItemCount} open item${s.openItemCount === 1 ? "" : "s"})`)
        .join("; ")}. ` +
      "You have counts only, not what the items are. Tell the coordinator who to follow up on and that the student's instructor has the detail. Never guess what an item is.",
  };
}

function staffAttentionResult(top: QueueEntry[]): AgentToolResult {
  return {
    status: "success",
    summary: `${top.length} student${top.length === 1 ? "" : "s"} could use a check-in.`,
    data: {
      students: top.map((s) => ({
        name: s.name,
        urgencyScore: s.urgencyScore,
        reasons: s.urgencyReasons,
        alert: s.primaryAlert?.title ?? null,
        suggestedAction: s.recommendedAction.label,
      })),
    },
    action: { action: "navigate", target: "/teacher", label: "Open dashboard" },
    modelHint:
      `Students needing attention, most urgent first: ${top
        .map((s) => `${s.name} (${s.urgencyReasons.join(", ") || "general concern"})`)
        .join("; ")}. ` +
      "Summarize for the teacher in plain language: lead with the 1-2 most urgent and exactly why, then a concrete next step for each (message them, review their plan, check evidence). Don't recite the whole list mechanically.",
  };
}

const listStudentsNeedingAttention: AgentTool = {
  name: "list_students_needing_attention",
  description:
    "List the students who most need a check-in right now, ranked by urgency. Use when staff ask who's behind, who needs help, or where to focus today. Scoped to the students they manage or oversee. Instructors and admins see the reasons (stalled goals, overdue tasks, low activity, open items); coordinators see a count of open items per student only.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "How many students to return (default 8, max 20)." },
    },
  },
  slashCommand: {
    command: "/attention",
    label: "Who needs attention",
    description: "Students who most need a check-in",
  },
  requiredRoles: ["teacher", "admin", "coordinator", "program_coordinator"],
  riskTier: "read",
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);
    const { getCoordinatorInterventionQueue, getInterventionQueue } = await import(
      "@/lib/teacher/dashboard"
    );
    // Coordinator sessions collapse to role="student" under RLS (Slice D not
    // shipped), so the RLS-scoped queue query silently returns zero rows for
    // them. Route coordinators through the region-scoped prismaAdmin read.
    const isCoordinator = isCoordinatorRole(ctx.session.role);
    const { queue } = isCoordinator
      ? await getCoordinatorInterventionQueue(ctx.session)
      : await getInterventionQueue(ctx.session);

    if (queue.length === 0) {
      return {
        status: "success",
        summary: "No students are flagged for attention right now.",
        data: { students: [] },
        modelHint:
          "Everyone in this staff member's scope looks on track. Say so warmly and offer to look at a specific class if they'd like.",
      };
    }

    const top = queue.slice(0, limit);
    return isCoordinator ? coordinatorAttentionResult(top) : staffAttentionResult(top);
  },
};

export const TEACHER_TOOLS: AgentTool[] = [listStudentsNeedingAttention];
