#!/usr/bin/env node

/**
 * Put the synthetic benchmark cohort into a database.
 *
 * The in-process suites (matching quality, hard blocks, packet privacy, report
 * parity, the state-machine walks) read the cohort straight from JSON and need
 * nothing here. This script exists for the ones that cannot: the Connect
 * Playwright journey, the nudge sweep, the query-plan and matching-at-scale
 * benchmarks, and anything else whose subject is the database itself.
 *
 *   DATABASE_URL="postgres://…/visionquest_local" npx tsx scripts/bench/seed-cohort.ts
 *   DATABASE_URL="…" npx tsx scripts/bench/seed-cohort.ts --reset
 *
 * Reads `ADMIN_DATABASE_URL` first, then `DATABASE_URL`. The admin role is
 * preferred because the cohort spans tables whose RLS policies have no student
 * branch (Employer, EmployerContact, JobLead) — under `vq_app` with no session
 * context those writes are refused, and the failure looks like a bug in this
 * script rather than what it is.
 *
 * IDEMPOTENT. Every row is upserted on its `cbench`-prefixed primary key, so a
 * re-run is a no-op and a partially-seeded database repairs itself. `--reset`
 * deletes every `cbench` row in FK-safe order, which is the only supported way
 * to remove them.
 *
 * SAFETY. Two gates, and the second one has no override:
 *
 *   1. `assertSafeE2eSeedTarget` (src/lib/e2e-seed-guard.ts) — the same guard
 *      the e2e fixture seed uses. Local hosts and `*_ci` / `*_local` database
 *      names only, unless `--allow-remote` is passed. This cohort creates
 *      accounts whose password is committed to this repository, so the guard
 *      applies for exactly the same reason it does there.
 *   2. A production-shape refusal that `--allow-remote` does NOT lift. A
 *      Supabase, Render or "prod"-named host is refused outright. The first
 *      gate has an escape hatch by design (a developer with an unusual local
 *      setup needs one); a `--reset` against production would delete real rows
 *      that merely happen to share a prefix, so that path gets no hatch at all.
 */

import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

import { BENCH_INSTRUCTOR_PASSWORD, BENCH_STUDENT_PASSWORD } from "../../e2e/bench-fixtures";
import { assertSafeE2eSeedTarget } from "../../src/lib/e2e-seed-guard";
import { BENCH_ID_PREFIX } from "./generate-cohort.mjs";
import { loadCohort } from "./lib/cohort.mjs";

// Already-set process env always wins — @next/env never overrides an existing
// variable, so an inline DATABASE_URL beats .env.local.
loadEnvConfig(process.cwd(), true);

/**
 * Hosts and database names this script refuses regardless of `--allow-remote`.
 *
 * Deliberately over-broad. The cost of refusing a database that only looks
 * production-shaped is one flag away in the other direction (rename it, or run
 * against a local copy); the cost of a `--reset` against the real thing is
 * unrecoverable.
 */
const PRODUCTION_SHAPED = [/supabase\./iu, /\.render\.com$/iu, /neon\.tech$/iu, /prod/iu];

function assertNotProduction(databaseUrl: string): void {
  let host: string;
  let database: string;
  try {
    const url = new URL(databaseUrl);
    host = url.hostname;
    database = url.pathname.replace(/^\//u, "");
  } catch {
    throw new Error("DATABASE_URL is not a parseable connection string.");
  }

  for (const pattern of PRODUCTION_SHAPED) {
    if (pattern.test(host) || pattern.test(database)) {
      throw new Error(
        `Refusing to seed the benchmark cohort against host "${host}" (database ` +
          `"${database}"): it matches ${pattern}, which this script treats as production. ` +
          "There is no override for this check — point DATABASE_URL at a local or CI " +
          "database instead.",
      );
    }
  }
}

/**
 * Delete order. Children before parents, and `Connection` before `Student`.
 *
 * That last one is not incidental: `Connection.proposedById` is RESTRICT (a
 * disclosure record has to outlive every party to it), so deleting a student
 * who proposed a connection FAILS rather than cascading. Same trap
 * `scripts/seed-e2e-users.ts` documents; the order below is the fix.
 *
 * Rows are matched BY ID PREFIX, not by the id list the current cohort holds.
 * The difference bites the moment the cohort changes: a student the generator
 * dropped, or an id scheme that moved, leaves rows the new list does not name —
 * so a `--reset` reported "0 rows removed" against a database still full of
 * them, and the next seed died on a unique constraint. Matching the prefix
 * means reset cleans up after generations of the fixture, not just this one.
 */
type Deleter = { label: string; run: (prisma: PrismaClient) => Promise<{ count: number }> };

function deleteOrder(prefix: string): Deleter[] {
  const mine = { startsWith: prefix };

  return [
    {
      label: "appointments",
      run: (p) => p.appointment.deleteMany({ where: { studentId: mine } }),
    },
    {
      label: "employment follow-ups",
      run: (p) =>
        p.spokesEmploymentFollowUp.deleteMany({ where: { recordId: mine } }),
    },
    {
      label: "SPOKES records",
      run: (p) => p.spokesRecord.deleteMany({ where: { id: mine } }),
    },
    {
      label: "connection events",
      run: (p) => p.connectionEvent.deleteMany({ where: { connectionId: mine } }),
    },
    {
      label: "outbound messages",
      run: (p) => p.outboundMessage.deleteMany({ where: { connectionId: mine } }),
    },
    {
      label: "connections",
      run: (p) => p.connection.deleteMany({ where: { id: mine } }),
    },
    {
      label: "applications",
      run: (p) => p.application.deleteMany({ where: { id: mine } }),
    },
    {
      label: "opportunities",
      run: (p) => p.opportunity.deleteMany({ where: { id: mine } }),
    },
    {
      label: "saved jobs",
      run: (p) => p.studentSavedJob.deleteMany({ where: { studentId: mine } }),
    },
    {
      label: "job listings",
      run: (p) => p.jobListing.deleteMany({ where: { id: mine } }),
    },
    { label: "job leads", run: (p) => p.jobLead.deleteMany({ where: { id: mine } }) },
    {
      label: "employer contacts",
      run: (p) => p.employerContact.deleteMany({ where: { employerId: mine } }),
    },
    {
      label: "employers",
      run: (p) => p.employer.deleteMany({ where: { id: mine } }),
    },
    {
      label: "work profiles",
      run: (p) => p.studentWorkProfile.deleteMany({ where: { studentId: mine } }),
    },
    {
      label: "certifications",
      run: (p) => p.certification.deleteMany({ where: { studentId: mine } }),
    },
    {
      label: "résumé data",
      run: (p) => p.resumeData.deleteMany({ where: { studentId: mine } }),
    },
    {
      label: "career discovery",
      run: (p) => p.careerDiscovery.deleteMany({ where: { studentId: mine } }),
    },
    {
      label: "recovery answers",
      run: (p) => p.securityQuestionAnswer.deleteMany({ where: { studentId: mine } }),
    },
    {
      label: "advisor availability",
      run: (p) => p.advisorAvailability.deleteMany({ where: { advisorId: mine } }),
    },
    {
      label: "enrollments",
      run: (p) => p.studentClassEnrollment.deleteMany({ where: { classId: mine } }),
    },
    {
      label: "class instructors",
      run: (p) => p.spokesClassInstructor.deleteMany({ where: { classId: mine } }),
    },
    {
      label: "class job configs",
      run: (p) => p.jobClassConfig.deleteMany({ where: { classId: mine } }),
    },
    { label: "classes", run: (p) => p.spokesClass.deleteMany({ where: { id: mine } }) },
    { label: "students", run: (p) => p.student.deleteMany({ where: { id: mine } }) },
  ];
}

interface CohortRow {
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "Neither ADMIN_DATABASE_URL nor DATABASE_URL is set — pass one inline or provide .env.local.",
    );
  }

  // Both gates run BEFORE any connection is opened.
  assertNotProduction(databaseUrl);
  assertSafeE2eSeedTarget(databaseUrl, {
    allowRemote: process.argv.includes("--allow-remote"),
  });

  // Imported lazily so env is loaded before src/lib/db.ts initializes through
  // auth.ts, exactly as scripts/seed-e2e-users.ts does.
  const { hashPassword } = await import("../../src/lib/auth");
  const { hashSecurityAnswers } = await import("../../src/lib/security-question-auth");

  const cohort = loadCohort() as unknown as Record<string, CohortRow[]> & {
    meta: { epoch: string };
  };
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const reset = process.argv.includes("--reset");

  try {
    if (reset) {
      let total = 0;
      for (const step of deleteOrder(BENCH_ID_PREFIX)) {
        const { count } = await step.run(prisma);
        total += count;
        if (count > 0) console.log(`  removed ${count} ${step.label}`);
      }
      console.log(`Reset: ${total} benchmark-cohort rows removed.`);
      return;
    }

    const date = (value: string | null): Date | null => (value ? new Date(value) : null);
    const dateOnly = (value: string | null): Date | null =>
      value ? new Date(`${value}T00:00:00.000Z`) : null;

    // ── Staff and students ───────────────────────────────────────────────
    for (const instructor of cohort.instructors) {
      const data = {
        studentId: instructor.login as string,
        email: instructor.email as string,
        displayName: instructor.displayName as string,
        passwordHash: hashPassword(BENCH_INSTRUCTOR_PASSWORD).hash,
        role: "teacher",
        isActive: true,
      };
      await prisma.student.upsert({
        where: { id: instructor.id as string },
        update: data,
        create: { id: instructor.id as string, ...data },
      });
    }

    for (const student of cohort.students) {
      const data = {
        studentId: student.login as string,
        email: student.email as string,
        displayName: student.displayName as string,
        passwordHash: hashPassword(BENCH_STUDENT_PASSWORD).hash,
        role: "student",
        isActive: true,
      };
      await prisma.student.upsert({
        where: { id: student.id as string },
        update: data,
        create: { id: student.id as string, ...data },
      });
    }

    // ── Classes, job config, enrollments ─────────────────────────────────
    for (const cls of cohort.classes) {
      const data = {
        name: cls.name as string,
        code: cls.code as string,
        status: "active",
      };
      await prisma.spokesClass.upsert({
        where: { id: cls.id as string },
        update: data,
        create: { id: cls.id as string, ...data },
      });
      await prisma.spokesClassInstructor.upsert({
        where: {
          classId_instructorId: {
            classId: cls.id as string,
            instructorId: cls.instructorId as string,
          },
        },
        update: {},
        create: { classId: cls.id as string, instructorId: cls.instructorId as string },
      });
      await prisma.jobClassConfig.upsert({
        where: { classId: cls.id as string },
        update: { region: cls.region as string, localJobPriority: cls.localJobPriority as string },
        create: {
          id: `cbenchjobconfig${(cls.id as string).replace("cbenchclass", "")}`,
          classId: cls.id as string,
          region: cls.region as string,
          localJobPriority: cls.localJobPriority as string,
        },
      });
    }

    // ── Recovery questions ───────────────────────────────────────────────
    //
    // Not optional, and not obvious: the `(student)` layout redirects to
    // /recovery-setup before ANY student page when the three-question set is
    // missing. The Connect journey's first browser step therefore landed on
    // "Keep your account safe" instead of Career, and read as a missing
    // approval card. Every browser-driven benchmark over this cohort needs
    // these, so they are seeded for staff and students alike.
    const recoveryAnswers = hashSecurityAnswers({
      birth_city: "Benchville",
      elementary_school: "Bench Elementary",
      favorite_teacher: "Benchy",
    });
    for (const person of [...cohort.instructors, ...cohort.students]) {
      for (const answer of recoveryAnswers) {
        await prisma.securityQuestionAnswer.upsert({
          where: {
            studentId_questionKey: {
              studentId: person.id as string,
              questionKey: answer.questionKey,
            },
          },
          update: { answerHash: answer.answerHash },
          create: {
            studentId: person.id as string,
            questionKey: answer.questionKey,
            answerHash: answer.answerHash,
          },
        });
      }
    }

    // Weekly advising availability for each instructor.
    //
    // Not decoration: `listInstructorSlots` builds the employer response page's
    // "pick a time to meet" list from AdvisorAvailability, so without these the
    // page tells every employer "There are no open times right now" and the
    // interview-booking half of the Connect journey cannot be exercised at all.
    //
    // The windows come from the committed fixture rather than a loop here, so
    // the generator can assert that no seeded appointment falls inside one --
    // a scheduled appointment inside a bookable window would let the journey
    // book a slot that collides with a seeded row on the partial unique index
    // `Appointment_advisorId_startsAt_scheduled_key`.
    for (const block of cohort.advisorAvailability) {
      const { id, ...data } = block;
      await prisma.advisorAvailability.upsert({
        where: { id: id as string },
        update: data as never,
        create: block as never,
      });
    }

    for (const student of cohort.students) {
      await prisma.studentClassEnrollment.upsert({
        where: {
          classId_studentId: {
            classId: student.classId as string,
            studentId: student.id as string,
          },
        },
        update: { status: "active" },
        create: {
          classId: student.classId as string,
          studentId: student.id as string,
          status: "active",
        },
      });
    }

    // ── Student career data ──────────────────────────────────────────────
    for (const [index, student] of cohort.students.entries()) {
      await prisma.careerDiscovery.upsert({
        where: { studentId: student.id as string },
        update: {
          status: "complete",
          topClusters: student.topClusters as string[],
          hollandCode: student.hollandCode as string,
        },
        create: {
          studentId: student.id as string,
          status: "complete",
          topClusters: student.topClusters as string[],
          hollandCode: student.hollandCode as string,
          completedAt: new Date(cohort.meta.epoch),
        },
      });

      // The résumé is stored as a JSON STRING in a Text column, which is what
      // `parseStoredResumeData` expects — writing an object here would produce
      // "[object Object]" and a silently empty skills list.
      //
      // The contact block is POPULATED on purpose. A real student's résumé
      // carries their phone, email and town, and `renderPacketPdf` strips
      // exactly that before the employer sees the document. Seeding a blank
      // contact block would make `packet-privacy` pass because there was
      // nothing to leak, which is the least useful way for a privacy benchmark
      // to be green. These values are the same fictional ones the rest of the
      // cohort uses: a reserved 555 number, an undeliverable domain, a real
      // WV town.
      const profile = cohort.workProfiles.find((row) => row.studentId === student.id);
      const resume = JSON.stringify({
        contact: {
          email: student.email as string,
          phone: `(304) 555-01${String(index % 100).padStart(2, "0")}`,
          location: `${(profile?.county as string) ?? "Raleigh"} County, WV ${
            (profile?.homeZip as string) ?? "25801"
          }`,
          website: "",
          linkedin: "",
        },
        summary: `${student.firstName as string} is finishing SPOKES and looking for work.`,
        skills: student.resumeSkills as string[],
        experience: [],
        education: [],
      });
      await prisma.resumeData.upsert({
        where: { studentId: student.id as string },
        update: { data: resume },
        create: { studentId: student.id as string, data: resume },
      });

      for (const certType of student.verifiedCertIds as string[]) {
        await prisma.certification.upsert({
          where: {
            studentId_certType: { studentId: student.id as string, certType },
          },
          update: { status: "completed", verificationStatus: "verified" },
          create: {
            studentId: student.id as string,
            certType,
            status: "completed",
            completedAt: new Date(cohort.meta.epoch),
            verificationStatus: "verified",
          },
        });
      }
    }

    for (const profile of cohort.workProfiles) {
      const data = {
        availability: profile.availability as object,
        transport: profile.transport as string | null,
        homeZip: profile.homeZip as string,
        county: profile.county as string,
        maxCommuteMinutes: profile.maxCommuteMinutes as number | null,
        payFloorHourly: profile.payFloorHourly as number | null,
        childcareHours: (profile.childcareHours ?? undefined) as object | undefined,
        earliestStart: dateOnly(profile.earliestStart as string | null),
        shiftLimits: (profile.shiftLimits ?? undefined) as object | undefined,
        updatedVia: profile.updatedVia as string,
      };
      await prisma.studentWorkProfile.upsert({
        where: { studentId: profile.studentId as string },
        update: data,
        create: { studentId: profile.studentId as string, ...data },
      });
    }

    // ── Employers, contacts, leads ───────────────────────────────────────
    for (const employer of cohort.employers) {
      const data = {
        name: employer.name as string,
        nameKey: employer.nameKey as string,
        legalName: employer.legalName as string,
        sector: employer.sector as string,
        clusters: employer.clusters as string[],
        county: employer.county as string,
        city: employer.city as string,
        zip: employer.zip as string,
        website: employer.website as string,
        hiredSpokesGradBefore: employer.hiredSpokesGradBefore as boolean,
        lastHiredAt: date(employer.lastHiredAt as string | null),
        subsidyFlags: employer.subsidyFlags as object,
        status: employer.status as string,
      };
      await prisma.employer.upsert({
        where: { id: employer.id as string },
        update: data,
        create: { id: employer.id as string, ...data },
      });
    }

    for (const contact of cohort.contacts) {
      const data = {
        employerId: contact.employerId as string,
        name: contact.name as string,
        role: contact.role as string,
        email: contact.email as string,
        phone: contact.phone as string,
        preferredChannel: contact.preferredChannel as string,
        contactConsentAt: date(contact.contactConsentAt as string | null),
        doNotContactAt: date(contact.doNotContactAt as string | null),
      };
      await prisma.employerContact.upsert({
        where: { id: contact.id as string },
        update: data,
        create: { id: contact.id as string, ...data },
      });
    }

    for (const lead of cohort.leads) {
      const data = {
        employerId: lead.employerId as string,
        employerName: lead.employerName as string,
        contactId: lead.contactId as string,
        classId: lead.classId as string | null,
        title: lead.title as string,
        description: lead.description as string,
        requirements: lead.requirements as object,
        schedule: lead.schedule as object,
        payMin: lead.payMin as number | null,
        payMax: lead.payMax as number | null,
        payPeriod: lead.payPeriod as string,
        location: lead.location as string,
        transitNotes: lead.transitNotes as string | null,
        distanceMiles: lead.distanceMiles as number | null,
        clusters: lead.clusters as string[],
        source: lead.source as string,
        sourceRef: lead.sourceRef as string | null,
        status: lead.status as string,
        openings: lead.openings as number,
        postedAt: new Date(lead.postedAt as string),
        createdById: lead.createdById as string,
      };
      await prisma.jobLead.upsert({
        where: { id: lead.id as string },
        update: data,
        create: { id: lead.id as string, ...data },
      });
    }

    // ── Scraped listings and saved jobs ──────────────────────────────────
    for (const listing of cohort.jobListings) {
      const data = {
        title: listing.title as string,
        company: listing.company as string,
        location: listing.location as string,
        description: listing.description as string,
        url: `https://jobs.example.invalid/${listing.id as string}`,
        source: listing.source as string,
        sourceType: "api",
        sourceId: listing.sourceId as string,
        salaryMin: listing.salaryMin as number,
        clusters: listing.clusters as string[],
        status: "active",
        scrapeBatchId: "bench-cohort",
        classConfigId: `cbenchjobconfig${(listing.classId as string).replace("cbenchclass", "")}`,
      };
      await prisma.jobListing.upsert({
        where: { id: listing.id as string },
        update: data,
        create: { id: listing.id as string, ...data },
      });
    }

    for (const saved of cohort.savedJobs) {
      const data = {
        studentId: saved.studentId as string,
        jobListingId: saved.jobListingId as string,
        status: saved.status as string,
        savedAt: new Date(saved.savedAt as string),
        appliedAt: date(saved.appliedAt as string | null),
      };
      await prisma.studentSavedJob.upsert({
        where: { id: saved.id as string },
        update: data,
        create: { id: saved.id as string, ...data },
      });
    }

    // ── Opportunities and applications ───────────────────────────────────
    //
    // `Application.opportunityId` is required, so every application needs an
    // Opportunity behind it even when the real source was a JobLead. That is
    // the same mirror-row the hire path writes today, and the same one owner
    // decision D5 may retire.
    for (const application of cohort.applications) {
      const lead = application.jobLeadId
        ? (cohort.leadById as unknown as Map<string, CohortRow>).get(
            application.jobLeadId as string,
          )
        : null;
      await prisma.opportunity.upsert({
        where: { id: application.opportunityId as string },
        update: {},
        create: {
          id: application.opportunityId as string,
          title: (lead?.title as string) ?? "Self-directed application",
          company: (lead?.employerName as string) ?? "Employer the student found",
          type: "job",
          location: (lead?.location as string) ?? null,
          status: "open",
          sourceJobLeadId: (application.jobLeadId as string | null) ?? null,
        },
      });

      const data = {
        studentId: application.studentId as string,
        opportunityId: application.opportunityId as string,
        status: application.status as string,
        verificationStatus: application.verificationStatus as string | null,
        appliedAt: date(application.appliedAt as string | null),
      };
      await prisma.application.upsert({
        where: { id: application.id as string },
        update: data,
        create: { id: application.id as string, ...data },
      });
    }

    // ── Appointments (before connections: one is an interview link) ───────
    for (const appointment of cohort.appointments) {
      const startsAt = new Date(appointment.scheduledAt as string);
      const data = {
        studentId: appointment.studentId as string,
        advisorId: appointment.advisorId as string,
        title: appointment.kind === "interview" ? "Interview" : "Advising check-in",
        startsAt,
        endsAt: new Date(
          startsAt.getTime() + (appointment.durationMinutes as number) * 60 * 1000,
        ),
        status: appointment.status as string,
        locationType: "in_person",
        locationLabel: appointment.location as string,
      };
      await prisma.appointment.upsert({
        where: { id: appointment.id as string },
        update: data,
        create: { id: appointment.id as string, ...data },
      });
    }

    // ── Connections and their events ─────────────────────────────────────
    const appointmentByConnection = new Map(
      cohort.appointments
        .filter((appointment) => appointment.connectionId)
        .map((appointment) => [appointment.connectionId as string, appointment.id as string]),
    );
    const applicationByConnection = new Map(
      cohort.applications
        .filter((application) => application.connectionId)
        .map((application) => [application.connectionId as string, application.id as string]),
    );

    for (const connection of cohort.connections) {
      const data = {
        studentId: connection.studentId as string,
        jobLeadId: connection.jobLeadId as string,
        employerId: connection.employerId as string,
        classId: connection.classId as string | null,
        proposedById: connection.proposedById as string,
        proposedVia: connection.proposedVia as string,
        status: connection.status as string,
        statusChangedAt: new Date(connection.statusChangedAt as string),
        packet: (connection.packet ?? undefined) as object | undefined,
        sentById: connection.sentById as string | null,
        sentAt: date(connection.sentAt as string | null),
        employerViewedAt: date(connection.employerViewedAt as string | null),
        employerRespondedAt: date(connection.employerRespondedAt as string | null),
        employerResponse: connection.employerResponse as string | null,
        hiredAt: date(connection.hiredAt as string | null),
        startDate: dateOnly(connection.startDate as string | null),
        hourlyWage: connection.hourlyWage as number | null,
        closedReason: connection.closedReason as string | null,
        interviewAppointmentId: appointmentByConnection.get(connection.id as string) ?? null,
        applicationId: applicationByConnection.get(connection.id as string) ?? null,
      };
      await prisma.connection.upsert({
        where: { id: connection.id as string },
        update: data,
        create: { id: connection.id as string, createdAt: new Date(connection.createdAt as string), ...data },
      });

      for (const event of connection.events as CohortRow[]) {
        const eventData = {
          connectionId: connection.id as string,
          fromStatus: event.fromStatus as string | null,
          toStatus: event.toStatus as string,
          actorType: event.actorType as string,
          actorId: null,
          at: new Date(event.at as string),
        };
        await prisma.connectionEvent.upsert({
          where: { id: event.id as string },
          update: eventData,
          create: { id: event.id as string, ...eventData },
        });
      }
    }

    // ── SPOKES records and follow-ups ────────────────────────────────────
    for (const record of cohort.spokesRecords) {
      const data = {
        studentId: record.studentId as string,
        firstName: record.firstName as string,
        lastName: record.lastName as string,
        county: record.county as string,
        status: record.status as string,
        referralDate: dateOnly(record.referralDate as string | null),
        enrolledAt: dateOnly(record.enrolledAt as string | null),
        exitDate: dateOnly(record.exitDate as string | null),
        unsubsidizedEmploymentAt: dateOnly(record.unsubsidizedEmploymentAt as string | null),
        employerName: record.employerName as string | null,
        hourlyWage: record.hourlyWage as number | null,
        postSecondaryEnteredAt: dateOnly(record.postSecondaryEnteredAt as string | null),
        placementApplicationId: record.placementApplicationId as string | null,
      };
      await prisma.spokesRecord.upsert({
        where: { id: record.id as string },
        update: data,
        create: { id: record.id as string, ...data },
      });

      for (const followUp of record.employmentFollowUps as CohortRow[]) {
        await prisma.spokesEmploymentFollowUp.upsert({
          where: {
            recordId_checkpointMonths: {
              recordId: record.id as string,
              checkpointMonths: followUp.checkpointMonths as number,
            },
          },
          update: { status: followUp.status as string },
          create: {
            recordId: record.id as string,
            checkpointMonths: followUp.checkpointMonths as number,
            status: followUp.status as string,
            checkedAt: dateOnly(followUp.checkedAt as string) as Date,
          },
        });
      }
    }

    console.log(
      `Seeded the benchmark cohort: ${cohort.students.length} students, ` +
        `${cohort.employers.length} employers, ${cohort.leads.length} leads, ` +
        `${cohort.connections.length} connections, ` +
        `${cohort.spokesRecords.filter((r) => r.unsubsidizedEmploymentAt).length} placements.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
