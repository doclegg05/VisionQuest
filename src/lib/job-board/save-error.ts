/**
 * Plain-language copy for job-save failures (VQ-R-016).
 *
 * `POST /api/jobs/save` returns a `code` alongside its error message so the
 * client can show something specific instead of doing nothing. This module
 * is the single place that maps a code to grade-6 copy, so the client and
 * any future surface agree on what the student sees.
 */

/** Thrown by client save helpers (`CareerHub.handleSaveJob`) so callers can
 * show `message` directly without re-deriving it from a fetch Response. */
export class SaveJobError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "SaveJobError";
  }
}

const GENERIC_SAVE_ERROR = "We couldn't save that job. Try again.";

/** Maps a `POST /api/jobs/save` error `code` to plain-language copy. */
export function describeSaveError(code?: string | null): string {
  if (code === "not_your_class_board") {
    return "This job isn't on your class's board yet. Try a different job below, or ask your teacher.";
  }
  return GENERIC_SAVE_ERROR;
}
