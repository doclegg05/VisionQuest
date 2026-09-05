import { test } from "node:test";
import assert from "node:assert/strict";
import { toMetrics } from "./backup-drill.mjs";

function metric(result, id) {
  return result.metrics.find((m) => m.id === id);
}

test("toMetrics: storage_reachable is 1 when configured with no error", () => {
  const result = toMetrics({
    tables: { Student: 5, FormSubmission: 1, FileUpload: 2, Certification: 3, SpokesRecord: 4 },
    storage: { configured: true, backend: "supabase-storage", error: null, archives: { objectCount: 7, studentDirCount: 2, truncated: false } },
  });
  assert.equal(metric(result, "storage_reachable").value, 1);
  assert.equal(metric(result, "archive_object_count").value, 7);
  assert.equal(metric(result, "student_rows").value, 5);
});

test("toMetrics: storage_reachable is 0 when unconfigured", () => {
  const result = toMetrics({
    tables: { Student: 0, FormSubmission: 0, FileUpload: 0, Certification: 0, SpokesRecord: 0 },
    storage: { configured: false, backend: null, error: null, archives: null },
  });
  assert.equal(metric(result, "storage_reachable").value, 0);
  assert.equal(metric(result, "archive_object_count").value, 0);
});

test("toMetrics: storage_reachable is 0 when configured but the probe errored — configured is not the same as reachable", () => {
  const result = toMetrics({
    tables: { Student: 1, FormSubmission: 0, FileUpload: 0, Certification: 0, SpokesRecord: 0 },
    storage: { configured: true, backend: "supabase-storage", error: "AccessDenied", archives: null },
  });
  assert.equal(metric(result, "storage_reachable").value, 0);
  assert.equal(metric(result, "storage_reachable").details.error, "AccessDenied");
});

test("toMetrics: emits every declared row-count metric even when a table is missing from the report", () => {
  const result = toMetrics({ tables: {}, storage: { configured: false, backend: null, error: null, archives: null } });
  for (const id of ["student_rows", "form_submission_rows", "file_upload_rows", "certification_rows", "spokes_record_rows"]) {
    assert.equal(metric(result, id).value, 0, id);
  }
});
