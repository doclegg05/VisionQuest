// =============================================================================
// loadCohort() — the synthetic cohort, as plain objects.
//
// THE CONTRACT for every suite that needs cohort data (matching, hard blocks,
// packet privacy, report parity, the Connect journey, and the later nudge,
// performance and journey suites). Read `config/benchmarks/synthetic-cohort/
// README.md` for what each collection holds; this module is the only supported
// way to get at it.
//
// Three properties callers may rely on:
//
//   1. PLAIN OBJECTS. No Prisma, no classes, no getters. Dates are ISO strings
//      (`@db.Date` columns are plain "YYYY-MM-DD"), because that is what
//      survives JSON and what the shared scorers already accept — every
//      `computeFunnel` / `buildDohsExportRow` input type takes `string | Date`.
//   2. FROZEN AND SHARED. One deep-frozen object is cached and handed to every
//      caller, so a suite that mutated its copy would corrupt the next suite in
//      the same process. Freezing makes that a TypeError at the point of the
//      mistake instead of a wrong number three suites later.
//   3. STABLE. The same bytes on every machine — the files are committed, and
//      `cohortChecksum()` is pinned by a unit test. A benchmark whose corpus
//      moves is not a benchmark.
// =============================================================================

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the committed fixture lives. */
export const COHORT_DIR = path.resolve(HERE, "..", "..", "..", "config", "benchmarks", "synthetic-cohort");

/**
 * Collection name -> file. Kept here rather than imported from the generator
 * so loading the cohort never pulls the generator (and its PRNG) in.
 * `synthetic-cohort.test.ts` pins the two maps against each other.
 */
export const COHORT_COLLECTIONS = {
  meta: "meta.json",
  instructors: "instructors.json",
  classes: "classes.json",
  students: "students.json",
  workProfiles: "work-profiles.json",
  employers: "employers.json",
  contacts: "contacts.json",
  leads: "leads.json",
  connections: "connections.json",
  spokesRecords: "spokes-records.json",
  applications: "applications.json",
  jobListings: "job-listings.json",
  savedJobs: "saved-jobs.json",
  appointments: "appointments.json",
};

let cached = null;

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

/**
 * The whole cohort, deep-frozen and cached.
 *
 * Calling it twice returns the identical object — that is the "stable across
 * two calls" property the unit test asserts, and it is also what keeps a
 * 50 x 40 scorer from re-parsing 250 KB of JSON per student.
 */
export function loadCohort() {
  if (cached) return cached;

  const cohort = {};
  for (const [key, filename] of Object.entries(COHORT_COLLECTIONS)) {
    cohort[key] = JSON.parse(readFileSync(path.join(COHORT_DIR, filename), "utf8"));
  }

  // Convenience indexes. Built once here rather than in each of the eight
  // suites that need them, and non-enumerable so they never reach a checksum
  // or a JSON round-trip of the cohort itself.
  Object.defineProperties(cohort, {
    studentById: { value: indexBy(cohort.students, "id") },
    leadById: { value: indexBy(cohort.leads, "id") },
    employerById: { value: indexBy(cohort.employers, "id") },
    contactByEmployerId: { value: indexBy(cohort.contacts, "employerId") },
    classById: { value: indexBy(cohort.classes, "id") },
    workProfileByStudentId: { value: indexBy(cohort.workProfiles, "studentId") },
    connectionById: { value: indexBy(cohort.connections, "id") },
    connectionByKey: { value: indexBy(cohort.connections, "key") },
    spokesRecordByStudentId: { value: indexBy(cohort.spokesRecords, "studentId") },
  });

  cached = deepFreeze(cohort);
  return cached;
}

function indexBy(rows, key) {
  const map = new Map();
  for (const row of rows) map.set(row[key], row);
  return map;
}

/**
 * A checksum over the committed files, in a fixed order.
 *
 * Over the FILE BYTES rather than over `loadCohort()`'s output: the output
 * carries non-enumerable indexes and a re-serialization could differ by key
 * order or number formatting, so hashing it would make the pin depend on
 * `JSON.stringify` rather than on the fixture.
 */
export function cohortChecksum() {
  const hash = createHash("sha256");
  for (const filename of Object.values(COHORT_COLLECTIONS)) {
    hash.update(filename);
    hash.update(readFileSync(path.join(COHORT_DIR, filename)));
  }
  return hash.digest("hex");
}

/**
 * The leads one student can actually see, in the shape `fit()` takes.
 *
 * The same rule `rankLeadsForStudent`'s query and the `job_lead_read` RLS
 * policy both apply — open, and either program-wide or attached to a class the
 * student is enrolled in. Restated here because an in-process scorer has no
 * database to enforce it, and a suite that ranked over every lead would be
 * scoring a list no student is ever shown.
 */
export function visibleLeadsFor(cohort, student) {
  return cohort.leads.filter(
    (lead) => lead.status === "open" && (lead.classId === null || lead.classId === student.classId),
  );
}

/**
 * A cohort student in the `MatchStudent` shape `fit()` expects.
 *
 * `withdrawnEmployerIds` is empty for every student: the cohort has no
 * withdrawn-from-employer history, and a caller that needs that hard block
 * exercised passes its own list (the hard-blocks suite does exactly that).
 */
export function toMatchStudent(cohort, student) {
  const profile = cohort.workProfileByStudentId.get(student.id) ?? null;
  return {
    studentId: student.id,
    displayName: student.displayName,
    workProfile: profile
      ? {
          studentId: profile.studentId,
          availability: profile.availability,
          transport: profile.transport,
          homeZip: profile.homeZip,
          county: profile.county,
          maxCommuteMinutes: profile.maxCommuteMinutes,
          payFloorHourly: profile.payFloorHourly,
          childcareHours: profile.childcareHours,
          earliestStart: profile.earliestStart,
          shiftLimits: profile.shiftLimits,
          updatedAt: cohort.meta.epoch,
          updatedVia: profile.updatedVia,
        }
      : null,
    verifiedCertIds: [...student.verifiedCertIds],
    discovery: { topClusters: [...student.topClusters], hollandCode: student.hollandCode },
    resumeSkills: [...student.resumeSkills],
    classRegion: student.classRegion,
    withdrawnEmployerIds: [],
  };
}

/** A cohort lead in the `MatchLead` shape `fit()` expects. */
export function toMatchLead(lead) {
  return {
    id: lead.id,
    title: lead.title,
    description: lead.description,
    employerId: lead.employerId,
    employerName: lead.employerName,
    employerStatus: lead.employerStatus,
    employerHiredSpokesGradBefore: lead.employerHiredSpokesGradBefore,
    status: lead.status,
    location: lead.location,
    clusters: [...lead.clusters],
    requirements: {
      mustHaveCerts: [...lead.requirements.mustHaveCerts],
      niceToHave: [...lead.requirements.niceToHave],
      physical: [...lead.requirements.physical],
      licenses: [...lead.requirements.licenses],
    },
    schedule: { ...lead.schedule, shifts: [...lead.schedule.shifts] },
    payMin: lead.payMin,
    payMax: lead.payMax,
    payPeriod: lead.payPeriod,
    transitNotes: lead.transitNotes,
    distanceMiles: lead.distanceMiles,
    source: lead.source,
  };
}
