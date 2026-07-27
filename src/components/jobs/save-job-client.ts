import type { JobTrackingUpdate } from "./JobCard";
import type { JobListingKind } from "@/lib/job-board/types";

// =============================================================================
// VQ-R-016 — shared save path for the job UI. The old handlers ignored
// !res.ok, so a failed save looked like nothing happened. This helper sends
// the right id field for the listing kind (class board vs program-wide browse
// pool, VQ-R-017) and returns a student-readable error instead of swallowing
// the failure.
// =============================================================================

export interface SaveJobResult {
  ok: boolean;
  /** Student-readable message when ok is false; null on success. */
  error: string | null;
}

const GENERIC_SAVE_ERROR = "We couldn't save this job. Please try again.";
const CONNECTION_SAVE_ERROR =
  "We couldn't save this job. Check your connection and try again.";

async function readServerError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message =
      body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : null;
    return typeof message === "string" && message.trim() ? message : GENERIC_SAVE_ERROR;
  } catch {
    return GENERIC_SAVE_ERROR;
  }
}

/**
 * POST /api/jobs/save with the id field matching the listing kind. `kind`
 * defaults to the class field so callers that predate listingKind keep
 * working. `fetchImpl` is injectable for tests only.
 */
export async function postJobSave(
  jobId: string,
  updates: JobTrackingUpdate | undefined,
  kind: JobListingKind | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveJobResult> {
  const idField =
    kind === "browse" ? { browseListingId: jobId } : { jobListingId: jobId };
  try {
    const response = await fetchImpl("/api/jobs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...idField, ...(updates ?? {}) }),
    });
    if (!response.ok) {
      return { ok: false, error: await readServerError(response) };
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: CONNECTION_SAVE_ERROR };
  }
}
