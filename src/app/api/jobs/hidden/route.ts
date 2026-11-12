import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, badRequest, forbidden, ApiError, type Session } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { parseBody } from "@/lib/schemas";
import {
  hideJobForStudent,
  isJobHideEnabled,
  listHiddenJobs,
  resolveListingForStudent,
  restoreHiddenJob,
} from "@/lib/job-board/job-preferences";

const hiddenActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("hide"),
    // A class-board JobListing id or a browse-pool JobBrowseListing id.
    jobListingId: z.string().cuid("Invalid job listing ID."),
  }),
  z.object({
    action: z.literal("restore"),
    hiddenJobId: z.string().cuid("Invalid hidden job ID."),
  }),
]);

/** Only students hide jobs. Staff would write onto their own row. */
function requireStudent(session: Session): void {
  if (session.role !== "student") {
    throw forbidden("Only students can hide jobs.");
  }
}

function hideDisabled() {
  return new ApiError(404, "Hiding jobs is turned off right now.", "job_hide_disabled");
}

/**
 * GET /api/jobs/hidden
 *
 * The student's open "Not interested" choices, for the Restore list.
 * `hideEnabled: false` (SystemConfig job_hide_enabled = "off") tells the
 * client to show no hide or restore buttons; stored rows are kept.
 */
export const GET = withAuth(async (session: Session) => {
  requireStudent(session);
  if (!(await isJobHideEnabled())) {
    return NextResponse.json({ hideEnabled: false, hiddenJobs: [] });
  }
  const hiddenJobs = await listHiddenJobs(session.id);
  return NextResponse.json({ hideEnabled: true, hiddenJobs });
});

/**
 * POST /api/jobs/hidden
 *
 * { action: "hide", jobListingId }  hides that vacancy for this student.
 * { action: "restore", hiddenJobId } shows it again (the row stays as history).
 * Hiding never touches the saved-job tracker or an Application.
 */
export const POST = withAuth(async (session: Session, req: Request) => {
  requireStudent(session);
  const body = await parseBody(req, hiddenActionSchema);
  if (!(await isJobHideEnabled())) {
    throw hideDisabled();
  }

  if (body.action === "hide") {
    const listing = await resolveListingForStudent(session.id, body.jobListingId);
    if (!listing) {
      throw badRequest("Job listing not found");
    }
    const hiddenJob = await hideJobForStudent(session.id, listing);
    await logAuditEvent({
      action: "job.hide",
      actorId: session.id,
      targetType: "StudentHiddenJob",
      targetId: hiddenJob.id,
      summary: `Student hid job "${listing.title}"`,
    });
    return NextResponse.json({ hiddenJob });
  }

  const hiddenJob = await restoreHiddenJob(session.id, body.hiddenJobId);
  if (!hiddenJob) {
    throw new ApiError(404, "That hidden job was not found.", "hidden_job_not_found");
  }
  await logAuditEvent({
    action: "job.restore",
    actorId: session.id,
    targetType: "StudentHiddenJob",
    targetId: hiddenJob.id,
    summary: `Student restored a hidden job`,
  });
  return NextResponse.json({ hiddenJob });
});
