/**
 * WorkForce West Virginia postings inside the National Labor Exchange (NLx).
 *
 * WorkForce WV enters jobs into the MACC (Mid-Atlantic Career Consortium, the
 * state job bank) on behalf of local employers. Those rows reach the NLx feed
 * under one anonymised company name, "West Virginia Employer", and their
 * apply link leads back into the MACC, where the student must sign in. The
 * WVDE student handout (docs/plans/2026-09-04-nlx-macc-job-search-research.md)
 * teaches students to find that label by hand on usnlx.com; this module is
 * the in-app equivalent, shared by the CareerOneStop adapter (which requests
 * the label directly) and the job card (which explains the MACC step).
 *
 * Why it matters: WV Works (TANF) participants must be registered in the
 * MACC, and applications made inside it are recorded as work-search activity
 * automatically — no screenshots for the student to keep.
 */

/** Exact company string NLx uses for WorkForce WV staff-entered postings. */
export const WORKFORCE_WV_COMPANY_LABEL = "West Virginia Employer";

/** Source whose company field carries the NLx label verbatim. */
const NLX_SOURCE = "careeronestop";

/**
 * Plain-language line shown beside the apply link on a WorkForce WV posting.
 * Grade-6 target: short words, one idea per sentence.
 */
export const MACC_APPLY_HINT =
  "This job is on the MACC, the WorkForce WV job site. You will sign in with your MACC account to apply. Applying there counts as a work search activity.";

/** Badge text on a WorkForce WV posting. */
export const WORKFORCE_WV_BADGE = "WorkForce WV posting";

export function isWorkForceWvPosting(job: {
  company: string | null | undefined;
  source: string | null | undefined;
}): boolean {
  if (job.source !== NLX_SOURCE) return false;
  const company = job.company?.trim().toLowerCase();
  return company === WORKFORCE_WV_COMPANY_LABEL.toLowerCase();
}
