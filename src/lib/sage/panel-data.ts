// =============================================================================
// Sage Panel — read/dismiss/refresh helpers for the dashboard render layer.
//
// Reads re-validate the stored Json with Zod on EVERY fetch: a stale,
// corrupt, or version-bumped spec returns null and the dashboard falls back
// to the static AmbientPanels. Writes go through prismaAdmin after an
// explicit ownership check (the RLS policy grants vq_app SELECT only).
// =============================================================================

import { prisma, prismaAdmin } from "@/lib/db";
import { isStaffRole, type Session } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { enqueueJobWithCooldown, processJobById } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import { parsePanelSpec, type PanelSpec } from "./panel-spec";

/** Panels older than this render nothing — a stale nudge is worse than none. */
const STALENESS_HOURS = 48;
/** Minimum gap between student-requested regenerations. */
const REFRESH_COOLDOWN_HOURS = 6;

export interface StudentPanel {
  id: string;
  spec: PanelSpec;
  generatedAt: Date;
  model: string | null;
}

/**
 * Latest renderable panel for a student, or null. Uses the RLS-scoped
 * client — in a server component this runs under the requester's context,
 * so cross-student reads are impossible even before the WHERE clause.
 */
export async function getLatestPanelSpec(studentId: string): Promise<StudentPanel | null> {
  const cutoff = new Date(Date.now() - STALENESS_HOURS * 60 * 60 * 1000);
  const row = await prisma.sagePanel.findFirst({
    where: { studentId, status: "ready", createdAt: { gte: cutoff } },
    select: { id: true, spec: true, createdAt: true, model: true },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;

  const spec = parsePanelSpec(row.spec);
  if (!spec) {
    logger.warn("panel-data: stored spec failed re-validation; hiding panel", {
      panelId: row.id,
    });
    return null;
  }
  return { id: row.id, spec, generatedAt: row.createdAt, model: row.model };
}

/**
 * Dismiss a panel. Students may dismiss their own; staff may dismiss for
 * students they manage (assertStaffCanManageStudent throws otherwise).
 * Returns false when the panel doesn't exist or the caller has no claim.
 */
export async function dismissPanel(panelId: string, session: Session): Promise<boolean> {
  const panel = await prismaAdmin.sagePanel.findUnique({
    where: { id: panelId },
    select: { id: true, studentId: true },
  });
  if (!panel) return false;

  if (panel.studentId !== session.id) {
    if (!isStaffRole(session.role)) return false;
    await assertStaffCanManageStudent(session, panel.studentId);
  }

  await prismaAdmin.sagePanel.update({
    where: { id: panel.id },
    data: { status: "dismissed", dismissedAt: new Date(), dismissedBy: session.id },
  });
  return true;
}

/**
 * Student-requested regeneration. Cooldown-guarded; the enqueued job runs
 * with force=true so it regenerates even over a dismissed panel (an explicit
 * refresh IS consent for a new one). Fire-and-forget processing keeps the
 * route snappy while the job stays durable if the process dies.
 */
export async function requestPanelRefresh(studentId: string): Promise<"queued" | "cooldown"> {
  const jobId = await enqueueJobWithCooldown({
    type: "sage_briefing",
    payload: { studentId, force: true },
    dedupeKey: `sage_briefing:refresh:${studentId}`,
    cooldownHours: REFRESH_COOLDOWN_HOURS,
  });
  if (!jobId) return "cooldown";

  void processJobById(jobId).catch((err) => {
    logger.error("panel-data: inline refresh processing failed (job remains queued)", {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  return "queued";
}
