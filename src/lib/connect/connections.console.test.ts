// =============================================================================
// listConnectionsForConsole — whose introductions the pipeline board shows.
//
// The board names students. A regular teacher may see every class (single
// SPOKES staff workspace), but the shared cohort demo instructor is held to the
// one class it teaches, and this query must hold it there itself rather than
// leave it to RLS alone.
// =============================================================================

import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { mockTeacherSession } from "@/lib/test-helpers";

const teacher = mockTeacherSession();
const demoInstructor = mockTeacherSession({ id: "demo-instructor", demoAccount: "instructor" });

/** Which instructors teach the class each student is enrolled in. */
const INSTRUCTORS_BY_STUDENT: Record<string, string[]> = {
  "demo-student": [demoInstructor.id],
  "other-student": ["tch-other"],
};

function connectionRow(id: string, studentId: string) {
  return {
    id,
    status: "student_approved",
    packet: null,
    student: { id: studentId, displayName: `Student ${studentId}` },
    jobLead: { title: "Production Associate", employerName: "Mountain Metal", contact: null },
  };
}

const ROWS = [connectionRow("conn-demo", "demo-student"), connectionRow("conn-other", "other-student")];

/** The one part of the query's `where` this fake reads. */
type ConsoleQuery = {
  where?: {
    student?: { classEnrollments?: { some?: { class?: { instructors?: { some?: { instructorId?: string } } } } } };
  };
};

// Applies the student → enrollment → class → instructor filter the way
// Postgres would, so the rows a viewer gets are the rows the query can reach.
const connectionFindMany = mock.fn(async (args: ConsoleQuery) => {
  const instructorId = args.where?.student?.classEnrollments?.some?.class?.instructors?.some?.instructorId;
  return ROWS.filter(
    (row) => instructorId === undefined || INSTRUCTORS_BY_STUDENT[row.student.id].includes(instructorId),
  );
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: { connection: { findMany: connectionFindMany } },
    prismaAdmin: {},
  },
});

let connections: typeof import("./connections");

before(async () => {
  connections = await import("./connections");
});

describe("listConnectionsForConsole", () => {
  it("shows the demo instructor only its own class's introductions", async () => {
    const rows = await connections.listConnectionsForConsole(demoInstructor);
    assert.deepEqual(rows.map((row) => row.studentId), ["demo-student"]);
  });

  it("still shows a regular teacher every class's introductions", async () => {
    const rows = await connections.listConnectionsForConsole(teacher);
    assert.deepEqual(rows.map((row) => row.studentId).sort(), ["demo-student", "other-student"]);
  });
});
