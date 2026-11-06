// =============================================================================
// listLeads — which job leads the Connect leads board shows.
//
// A lead is either program-wide (no class) or scoped to one class. A teacher,
// the shared cohort demo instructor included, sees program-wide leads and their
// own class's, never a lead that belongs to another class (organization tree,
// 2026-11). Admins and program coordinators see every class's leads.
// =============================================================================

import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { mockAdminSession, mockTeacherSession } from "@/lib/test-helpers";

const teacher = mockTeacherSession();
const admin = mockAdminSession();
const demoInstructor = mockTeacherSession({ id: "demo-instructor", demoAccount: "instructor" });

/** Who teaches each class a lead can be scoped to. */
const INSTRUCTORS_BY_CLASS: Record<string, string[]> = {
  "class-demo": [demoInstructor.id],
  "class-other": [teacher.id],
};

const LEADS = [
  { id: "lead-program", classId: null },
  { id: "lead-demo", classId: "class-demo" },
  { id: "lead-other", classId: "class-other" },
];

/** The one part of the query's `where` this fake reads. */
type LeadQuery = {
  where?: {
    OR?: Array<{ classId?: null; class?: { instructors?: { some?: { instructorId?: string } } } }>;
  };
};

// Applies the "program-wide, or a class this viewer teaches" filter the way
// Postgres would, so the leads a viewer gets are the rows the query can reach.
const jobLeadFindMany = mock.fn(async (args: LeadQuery) => {
  const clauses = args.where?.OR;
  if (!clauses) return LEADS;
  return LEADS.filter((lead) =>
    clauses.some((clause) => {
      if ("classId" in clause) return lead.classId === clause.classId;
      const instructorId = clause.class?.instructors?.some?.instructorId;
      return lead.classId !== null && instructorId !== undefined && INSTRUCTORS_BY_CLASS[lead.classId].includes(instructorId);
    }),
  );
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: { jobLead: { findMany: jobLeadFindMany } },
    prismaAdmin: {},
  },
});

let leads: typeof import("./leads");

before(async () => {
  leads = await import("./leads");
});

describe("listLeads", () => {
  it("shows the demo instructor program-wide leads and its own class's, not another class's", async () => {
    const rows = await leads.listLeads({ viewer: demoInstructor, status: "open" });
    assert.deepEqual(rows.map((row) => row.id).sort(), ["lead-demo", "lead-program"]);
  });

  it("shows a regular teacher program-wide leads and their own class's only", async () => {
    const rows = await leads.listLeads({ viewer: teacher, status: "open" });
    assert.deepEqual(rows.map((row) => row.id).sort(), ["lead-other", "lead-program"]);
  });

  it("still shows an admin every class's leads", async () => {
    const rows = await leads.listLeads({ viewer: admin, status: "open" });
    assert.deepEqual(rows.map((row) => row.id).sort(), ["lead-demo", "lead-other", "lead-program"]);
  });
});
