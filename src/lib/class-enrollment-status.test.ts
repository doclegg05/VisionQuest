/**
 * A teacher changing one enrollment's status clears that student's kept
 * dashboard and Sage context, and no one else's. The write-through reads the
 * student from the row the update returns, which carries only the fields its
 * `select` names, so the select must name `studentId`. Without it the write
 * named no student and cleared every student's context.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cached } from "./cache";
import { applyChatContextWriteThrough, resolveChatContextInvalidation } from "./chat-context-write-through";
import { enrollmentStatusUpdateArgs } from "./class-enrollment-status";

const SID = "cenrollstatusaaaaaaaaaaa1";
const OTHER_SID = "cenrollstatusbbbbbbbbbbb2";
const STORED_ROW: Record<string, unknown> = {
  id: "enr-1",
  studentId: SID,
  classId: "class-1",
  status: "archived",
  archivedAt: new Date(0),
  archiveReason: "Moved away",
};

/** The row Postgres hands back: only the selected fields, as the engine returns them. */
function returnedRow(select: Record<string, boolean>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, STORED_ROW[key]]));
}

test("the status update returns the student, so the write-through names only that student", () => {
  const args = enrollmentStatusUpdateArgs("enr-1", "archived", "Moved away");
  assert.deepEqual(resolveChatContextInvalidation("StudentClassEnrollment", "update", args, returnedRow(args.select)),
    { scope: "students", studentIds: [SID] });
});

test("a status change clears that student's kept context and no one else's", async () => {
  for (const id of [SID, OTHER_SID]) await cached(`chat:snapshot:${id}`, 600, async () => "warm");
  const args = enrollmentStatusUpdateArgs("enr-1", "withdrawn", "");
  await applyChatContextWriteThrough("StudentClassEnrollment", "update", args, returnedRow(args.select));
  const reread = async (id: string) => {
    let again = false;
    await cached(`chat:snapshot:${id}`, 600, async () => { again = true; return "fresh"; });
    return again;
  };
  assert.equal(await reread(SID), true, "the student's kept context outlived the status change");
  assert.equal(await reread(OTHER_SID), false, "another student's kept context was cleared");
});

test("archiving stamps the time and reason; any other status clears both", () => {
  const archived = enrollmentStatusUpdateArgs("enr-1", "archived", "Moved away");
  assert.ok(archived.data.archivedAt instanceof Date);
  assert.equal(archived.data.archiveReason, "Moved away");
  assert.equal(enrollmentStatusUpdateArgs("enr-1", "archived", "").data.archiveReason, null);
  const active = enrollmentStatusUpdateArgs("enr-1", "active", "Moved away");
  assert.equal(active.data.archivedAt, null);
  assert.equal(active.data.archiveReason, null);
});
