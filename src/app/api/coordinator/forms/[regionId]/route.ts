import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden } from "@/lib/api-error";
import { tryLogAuditEvent } from "@/lib/audit";
import { withCoordinatorAuth } from "@/lib/coordinator-auth";
import {
  canReachFormCsvExport,
  coordinatorCanReadRegion,
  getRegionFormRollup,
} from "@/lib/forms/region-rollup";

interface RouteContext {
  params: Promise<{ regionId: string }>;
}

// The id reaches a compound-key lookup and three region-scoped `where`
// clauses. Its shape is checked here rather than trusted because the caller
// happens to be staff.
const regionIdSchema = z.string().cuid();

// Region-scoped forms rollup for the coordinator dashboard (C7).
//
// The dashboard's forms panel used to call /api/teacher/forms/templates,
// whose `withTeacherAuth` wrapper refuses coordinators outright, and to link
// /api/teacher/forms/[templateId]/export, which is admin-only in effect
// (withTeacherAuth ∩ canPerformElevatedStaffAction). A real coordinator got
// an error box and a dead CSV link.
//
// This route gives them the aggregate they were meant to have and nothing
// more: per-template completion COUNTS for the classes in one region they are
// assigned to. It does not export answers, and it deliberately does not widen
// the bulk CSV — that stays admin-only on its own route, because widening it
// would put individual students' intake answers in front of a role the
// elevated-action predicate was written to gate.
//
// `coordinator.student.view.region` is the permission: its seeded description
// is "Aggregate student data (counts, metrics) for coordinator reporting — no
// individual student detail", which is exactly this payload.
// `coordinator.forms.export` is left for a route that actually exports.
export const GET = withCoordinatorAuth(
  "coordinator.student.view.region",
  async (session, _req: Request, ctx: RouteContext) => {
    const { regionId: rawRegionId } = await ctx.params;
    const parsed = regionIdSchema.safeParse(rawRegionId);
    if (!parsed.success) throw badRequest("Invalid region id.");
    const regionId = parsed.data;

    // Second gate, fail-closed: the wrapper proved the ROLE, this proves the
    // REGION. An admin passes on any region that exists; a coordinator only
    // on one they hold an assignment row for.
    const authorized = await coordinatorCanReadRegion(session, regionId);
    if (!authorized) throw forbidden("You are not assigned to this region.");

    const rollup = await getRegionFormRollup(regionId);

    // A staff member reading a region's aggregate leaves the same kind of
    // trace the rest of the app leaves for staff reads of student data.
    // Written after the read, swallowed on failure (tryLogAuditEvent's own
    // contract), and carrying counts only — the region id and the shape of
    // what was returned, never a student identifier
    // (.claude/rules/security.md, Data Privacy).
    await tryLogAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "coordinator.forms.rollup.view",
      targetType: "region",
      targetId: regionId,
      summary: `Viewed form completion counts for ${rollup.classCount} class(es).`,
      metadata: {
        classCount: rollup.classCount,
        studentCount: rollup.studentCount,
        templateCount: rollup.templates.length,
        suppressed: rollup.templates.some((template) => template.suppressed),
      },
    });

    // The panel renders its CSV link from this flag, not from a role string
    // of its own, so a coordinator is never shown a link that 403s.
    return NextResponse.json({ rollup, canExport: canReachFormCsvExport(session.role) });
  },
);
