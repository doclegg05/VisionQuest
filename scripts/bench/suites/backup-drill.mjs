/**
 * bench suite: backup-drill (config/benchmarks/backup-drill.json)
 *
 * Wraps scripts/backup-verify.mjs's runBackupVerify() (exported this
 * session, no CLI behavior change — see its isMain guard) against
 * BENCH_PROD_READONLY_URL. As backup-verify.mjs's own header says: THIS
 * DOES NOT VERIFY A BACKUP. It has no access to Supabase's backup subsystem
 * (daily backups / PITR) — only the Supabase dashboard does. What this
 * checks is narrower: that the live data a backup would need to capture is
 * actually present, and that the configured object-storage backend answers.
 * A real restore drill is a quarterly OWNER STEP
 * (docs/runbooks/backup-restore.md §5) that this suite cannot automate and
 * does not claim to.
 *
 * storage_reachable is the one exact:true metric (1 = the backend answered
 * ListObjectsV2 with no error; 0 = unconfigured or errored). Every row count
 * is info — a floor on "how many students exist" is not this suite's job.
 */

import { runBackupVerify } from "../../backup-verify.mjs";
import { selfTest } from "../lib/self-test.mjs";

/**
 * Pure mapping from a backup-verify report to this suite's metric ids,
 * tested without a database in backup-drill.test.mjs.
 *
 * @param {{ tables: Record<string, number>, storage: { configured: boolean, error: string | null, archives: { objectCount: number } | null } }} report
 * @returns {{ metrics: Array<object> }}
 */
export function toMetrics(report) {
  const storageReachable = report.storage.configured && !report.storage.error ? 1 : 0;
  return {
    metrics: [
      {
        id: "storage_reachable",
        value: storageReachable,
        details: {
          configured: report.storage.configured,
          backend: report.storage.backend,
          error: report.storage.error,
        },
      },
      { id: "student_rows", value: report.tables.Student ?? 0 },
      { id: "form_submission_rows", value: report.tables.FormSubmission ?? 0 },
      { id: "file_upload_rows", value: report.tables.FileUpload ?? 0 },
      { id: "certification_rows", value: report.tables.Certification ?? 0 },
      { id: "spokes_record_rows", value: report.tables.SpokesRecord ?? 0 },
      {
        id: "archive_object_count",
        value: report.storage.archives?.objectCount ?? 0,
        details: {
          studentDirCount: report.storage.archives?.studentDirCount ?? 0,
          truncated: report.storage.archives?.truncated ?? false,
        },
      },
    ],
  };
}

/** @param {object} ctx @returns {Promise<{ metrics: Array<object> }>} */
export async function run(ctx) {
  const url = ctx.env.prodReadonlyUrl;
  if (!url) {
    throw new Error("backup-drill requires prod-readonly: set BENCH_PROD_READONLY_URL.");
  }
  const report = await runBackupVerify(url);
  return toMetrics(report);
}

await selfTest(import.meta.url, run);
