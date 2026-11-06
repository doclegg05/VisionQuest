// Pure parts of scripts/org-tree-preflight.mjs: the count queries and the output formatter.

const S = '"visionquest"';

// Each query returns exactly one integer column named "n". SELECT only.
export const PREFLIGHT_COUNTS = [
  {
    label: "active teacher accounts",
    sql: `SELECT count(*)::int AS n FROM ${S}."Student" WHERE "role" = 'teacher' AND "isActive" = true`,
  },
  {
    label: "active teachers who teach no class",
    sql: `SELECT count(*)::int AS n FROM ${S}."Student" s WHERE s."role" = 'teacher' AND s."isActive" = true AND NOT EXISTS (SELECT 1 FROM ${S}."SpokesClassInstructor" ci WHERE ci."instructorId" = s."id")`,
  },
  {
    label: "classes with no region",
    sql: `SELECT count(*)::int AS n FROM ${S}."SpokesClass" WHERE "regionId" IS NULL AND "archivedAt" IS NULL`,
  },
  {
    label: "active coordinator accounts",
    sql: `SELECT count(*)::int AS n FROM ${S}."Student" WHERE "role" = 'coordinator' AND "isActive" = true`,
  },
  {
    label: "active coordinators with no region",
    sql: `SELECT count(*)::int AS n FROM ${S}."Student" s WHERE s."role" = 'coordinator' AND s."isActive" = true AND NOT EXISTS (SELECT 1 FROM ${S}."RegionCoordinator" rc WHERE rc."coordinatorId" = s."id")`,
  },
  {
    label: "active students with no non-archived enrollment",
    sql: `SELECT count(*)::int AS n FROM ${S}."Student" s WHERE s."role" = 'student' AND s."isActive" = true AND NOT EXISTS (SELECT 1 FROM ${S}."StudentClassEnrollment" e WHERE e."studentId" = s."id" AND e."archivedAt" IS NULL)`,
  },
];

export function isSelectOnly(sql) {
  return /^\s*select\b/i.test(sql) && !/;/.test(sql);
}

// Prints a label and an integer per line. Anything that is not a non-negative integer is refused.
export function formatCounts(rows) {
  return rows
    .map(({ label, n }) => {
      if (!Number.isInteger(n) || n < 0) throw new Error(`Count for "${label}" is not a whole number`);
      return `${label}: ${n}`;
    })
    .join("\n");
}
