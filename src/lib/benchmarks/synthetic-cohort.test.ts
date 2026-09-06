// =============================================================================
// The synthetic benchmark cohort is a CONTRACT, and this file is what pins it.
//
// Six later benchmark suites and three later build agents read
// `loadCohort()`. If the fixture changes silently, every baseline measured
// against it becomes a lie — the numbers move, nothing in the code did, and the
// first person to notice is reading a "regression" that is really a corpus
// swap. So the committed bytes are checksummed here, and changing them is a
// deliberate act with a test to update.
//
// The other cases pin the two places where the fixture RESTATES something the
// product owns — the 14-cluster framework, and the shift vocabulary — so a
// rename in the product fails here rather than silently making every label in
// `matching-labels.json` wrong.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NATIONAL_CAREER_CLUSTERS } from "@/lib/spokes/national-clusters";
import { LEAD_SHIFTS } from "@/lib/connect/work-profile-shared";
import { CONNECTION_STATUSES, canTransition } from "@/lib/connect/pipeline-shared";

// The loader is `.mjs` on purpose: the benchmark runner starts plain Node and
// the scorers are plain ES modules, so the cohort must be readable without the
// TypeScript pipeline. tsx resolves it here.
import {
  COHORT_COLLECTIONS,
  cohortChecksum,
  loadCohort,
  toMatchLead,
  toMatchStudent,
  visibleLeadsFor,
} from "../../../scripts/bench/lib/cohort.mjs";
import { CLUSTERS, PROGRAM_CLUSTERS } from "../../../scripts/bench/lib/cohort-vocab.mjs";

/**
 * sha256 over every committed cohort file, in `COHORT_COLLECTIONS` order.
 *
 * To change it: edit `scripts/bench/generate-cohort.mjs`, run it, run
 * `node scripts/bench/generate-matching-labels.mjs`, then paste the value this
 * test prints on failure. Record in the benchmark baseline's `reason` that the
 * corpus moved, so the metric shifts that follow are not read as regressions.
 */
const COHORT_CHECKSUM = "c0998b693f5e88d14496a12cb8e39fcb7de97be5a4dca49ad8988d91164578ec";

describe("the synthetic cohort fixture", () => {
  it("is stable across two loads and returns the identical cached object", () => {
    const first = loadCohort();
    const second = loadCohort();

    // Identity, not deep equality: the contract promises one shared object, so
    // a 50 x 40 scorer does not re-parse a quarter of a megabyte per student.
    assert.equal(first, second);
    assert.equal(first.students.length, 50);
    assert.equal(first.leads.length, 40);
    assert.equal(first.connections.length, 20);
  });

  it("matches its committed checksum", () => {
    assert.equal(
      cohortChecksum(),
      COHORT_CHECKSUM,
      "The cohort files changed. If that was deliberate, paste the new checksum here and " +
        "note in reports/benchmarks/baseline.json that the corpus moved.",
    );
  });

  it("is deep-frozen, so one suite cannot corrupt the next", () => {
    const cohort = loadCohort();
    assert.throws(() => {
      (cohort.students as { length: number }).length = 0;
    }, TypeError);
    assert.throws(() => {
      (cohort.students[0] as { id: string }).id = "tampered";
    }, TypeError);
  });

  it("carries no real contact details", () => {
    const cohort = loadCohort();
    const text = JSON.stringify(cohort);

    // Every phone number is in the reserved fiction range, and every email
    // domain is undeliverable by RFC 2606. A fixture that grew a real-looking
    // address is one misconfigured test run away from mailing a stranger.
    for (const phone of cohort.contacts.map((contact: { phone: string }) => contact.phone)) {
      assert.match(phone, /^\(304\) 555-01\d{2}$/u, phone);
    }
    for (const email of cohort.contacts.map((contact: { email: string }) => contact.email)) {
      assert.ok(email.endsWith(".invalid"), email);
    }
    for (const email of cohort.students.map((student: { email: string }) => student.email)) {
      assert.ok(email.endsWith("@test.local"), email);
    }
    assert.ok(!text.includes("@example.com"), "example.com is deliverable; use .invalid");
    assert.ok(!text.includes("@gmail."));
  });

  it("prefixes every id with cbench, which is how the seed finds its own rows", () => {
    const cohort = loadCohort();
    const collections = [
      "instructors",
      "classes",
      "students",
      "employers",
      "contacts",
      "leads",
      "connections",
      "spokesRecords",
      "applications",
      "jobListings",
      "savedJobs",
      "appointments",
      "advisorAvailability",
    ] as const;

    for (const name of collections) {
      for (const row of cohort[name] as Array<{ id: string }>) {
        assert.ok(row.id.startsWith("cbench"), `${name}: ${row.id}`);
      }
    }
  });

  it("never gives one advisor two scheduled appointments at the same instant", () => {
    // `Appointment_advisorId_startsAt_scheduled_key` (migration 20260902140000)
    // is a PARTIAL unique index on (advisorId, startsAt) WHERE status =
    // 'scheduled'. Prisma cannot express a partial index, so it exists only in
    // the migration SQL and `prisma db push` does not create it -- which is
    // exactly how a colliding pair reached CI once: it seeded cleanly against a
    // pushed local database and failed against a migrated one.
    const cohort = loadCohort();
    const seen = new Set<string>();
    for (const appointment of cohort.appointments as Array<{
      advisorId: string;
      scheduledAt: string;
      status: string;
    }>) {
      if (appointment.status !== "scheduled") continue;
      const key = `${appointment.advisorId}@${appointment.scheduledAt}`;
      assert.ok(!seen.has(key), `two scheduled appointments share ${key}`);
      seen.add(key);
    }
  });

  it("keeps every scheduled appointment outside its advisor's bookable window", () => {
    // The Connect journey books an interview slot at runtime from
    // AdvisorAvailability. A seeded appointment sitting inside a bookable
    // window is a live collision on the same partial unique index -- either the
    // slot is silently dropped from the employer's list, or the booking hits
    // the constraint.
    const cohort = loadCohort();
    const windows = new Map<string, Array<{ weekday: number; start: number; end: number }>>();
    for (const block of cohort.advisorAvailability as Array<{
      advisorId: string;
      weekday: number;
      startMinutes: number;
      endMinutes: number;
      active: boolean;
    }>) {
      if (!block.active) continue;
      const list = windows.get(block.advisorId) ?? [];
      list.push({ weekday: block.weekday, start: block.startMinutes, end: block.endMinutes });
      windows.set(block.advisorId, list);
    }

    for (const appointment of cohort.appointments as Array<{
      id: string;
      advisorId: string;
      scheduledAt: string;
      status: string;
    }>) {
      if (appointment.status !== "scheduled") continue;
      const at = new Date(appointment.scheduledAt);
      // buildBookableAdvisorSlots reads the weekday and the minute of day in
      // UTC, so the comparison has to be UTC too.
      const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
      for (const window of windows.get(appointment.advisorId) ?? []) {
        const clashes =
          window.weekday === at.getUTCDay() && minutes >= window.start && minutes < window.end;
        assert.ok(!clashes, `${appointment.id} sits inside a bookable window`);
      }
    }
  });

  it("names one file per collection, with no collection unwritten", () => {
    const cohort = loadCohort();
    for (const key of Object.keys(COHORT_COLLECTIONS)) {
      assert.ok(cohort[key] !== undefined, `${key} has a file but no data`);
    }
  });
});

describe("the fixture's restatements of product vocabulary", () => {
  // Two files restate something the product owns, because a plain `.mjs`
  // generator may not import the TypeScript module graph. These cases are what
  // keep the restatements honest.

  it("uses the same 14 national clusters the product does", () => {
    assert.deepEqual(CLUSTERS, [...NATIONAL_CAREER_CLUSTERS]);
  });

  it("draws students and leads from a subset of the real cluster list", () => {
    for (const cluster of PROGRAM_CLUSTERS) {
      assert.ok(
        (NATIONAL_CAREER_CLUSTERS as readonly string[]).includes(cluster),
        `"${cluster}" is not a real cluster`,
      );
    }
  });

  it("gives every lead a schedule drawn from the real shift vocabulary", () => {
    const cohort = loadCohort();
    for (const lead of cohort.leads as Array<{ id: string; schedule: { shifts: string[] } }>) {
      for (const shift of lead.schedule.shifts) {
        assert.ok(
          (LEAD_SHIFTS as readonly string[]).includes(shift),
          `${lead.id} names shift "${shift}", which the product does not know`,
        );
      }
    }
  });

  it("gives every connection a status and a walk the real state machine allows", () => {
    const cohort = loadCohort();
    for (const connection of cohort.connections as Array<{
      id: string;
      status: string;
      rolledBackSend: boolean;
      events: Array<{ fromStatus: string | null; toStatus: string }>;
    }>) {
      assert.ok(
        (CONNECTION_STATUSES as readonly string[]).includes(connection.status),
        `${connection.id} has status "${connection.status}"`,
      );
      for (const event of connection.events) {
        if (event.fromStatus === null) {
          assert.equal(event.toStatus, "proposed", `${connection.id} starts at ${event.toStatus}`);
          continue;
        }
        assert.ok(
          canTransition(
            event.fromStatus as (typeof CONNECTION_STATUSES)[number],
            event.toStatus as (typeof CONNECTION_STATUSES)[number],
          ),
          `${connection.id}: ${event.fromStatus} -> ${event.toStatus} is not a legal move`,
        );
      }
    }
  });
});

describe("the properties later suites depend on", () => {
  it("keeps placements, placed SPOKES records and verified applications in step", () => {
    const cohort = loadCohort();
    const placements = (cohort.connections as Array<{ studentId: string; isPlacement: boolean }>)
      .filter((connection) => connection.isPlacement)
      .map((connection) => connection.studentId);
    const placed = (
      cohort.spokesRecords as Array<{ studentId: string; unsubsidizedEmploymentAt: string | null }>
    )
      .filter((record) => record.unsubsidizedEmploymentAt !== null)
      .map((record) => record.studentId);

    assert.deepEqual([...placements].sort(), [...placed].sort());
    assert.equal(placements.length, 6);
  });

  it("has no self-directed application that would count as a placement", () => {
    // `qualifiesForPlacement` needs accepted AND instructor-verified. One of
    // the three is accepted but only self-reported — the near miss that proves
    // the bar is both conditions, and the reason report parity still holds
    // while the funnel's comparison line is non-zero.
    const cohort = loadCohort();
    const selfDirected = (
      cohort.applications as Array<{
        selfDirected: boolean;
        status: string;
        verificationStatus: string | null;
      }>
    ).filter((application) => application.selfDirected);

    assert.equal(selfDirected.length, 3);
    for (const application of selfDirected) {
      assert.ok(
        !(application.status === "accepted" && application.verificationStatus === "verified"),
        "a self-directed application that qualifies would break report parity",
      );
    }
    assert.ok(selfDirected.some((application) => application.status === "accepted"));
  });

  it("keeps the three awkward walks the funnel is measured on", () => {
    const cohort = loadCohort();
    const rolledBack = cohort.connectionByKey.get("rolled-back-send");
    assert.equal(rolledBack.status, "student_approved");
    assert.equal(rolledBack.sentAt, null, "a rolled-back send must have no sentAt");
    assert.ok(
      rolledBack.events.some((event: { toStatus: string }) => event.toStatus === "sent"),
      "the append-only sent event must survive the rollback",
    );

    const skip = cohort.connectionByKey.get("hired-skip");
    assert.deepEqual(
      skip.events.map((event: { toStatus: string }) => event.toStatus),
      ["proposed", "student_approved", "sent", "viewed", "hired"],
    );

    const direct = cohort.connectionByKey.get("hired-direct");
    assert.ok(
      !direct.events.some((event: { toStatus: string }) => event.toStatus === "viewed"),
      "hired-direct exists to prove a hire needs no view",
    );
  });

  it("gives every student three visible leads to rank", () => {
    const cohort = loadCohort();
    for (const student of cohort.students) {
      assert.ok(
        visibleLeadsFor(cohort, student).length >= 3,
        `${student.id} can see fewer than three leads — precision@3 has nothing to fill`,
      );
    }
  });

  it("converts to the matcher's own input shapes", () => {
    const cohort = loadCohort();
    const student = toMatchStudent(cohort, cohort.students[0]);
    assert.equal(student.studentId, cohort.students[0].id);
    assert.deepEqual(student.withdrawnEmployerIds, []);
    assert.ok(student.workProfile);

    const lead = toMatchLead(cohort.leads[0]);
    assert.equal(lead.id, cohort.leads[0].id);
    assert.ok(Array.isArray(lead.requirements.mustHaveCerts));
    assert.ok(Array.isArray(lead.schedule.shifts));
  });
});
