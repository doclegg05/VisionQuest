/**
 * Consent-scopes integration proof — benchmark suite `consent-scopes`
 * (config/benchmarks/consent-scopes.json). Attempts the three write paths the
 * plan names — `sendConnection` (employer_referral), `sendPolicySms` (SMS
 * opt-in), `selectBatchStudents` (the WorkForce WV batch export) — for a
 * student who has never given the matching consent, and asserts every one of
 * them refuses rather than sending or including that student's data.
 *
 * Written as a node:test file, per the plan's own fallback ("If the hermetic
 * bootstrap cannot be reused outside node:test, implement the suite as a
 * node:test file the scorer executes as a child process and parses"):
 * `sendConnection` and `selectBatchStudents` call through the app's own
 * `prisma` singleton, which only becomes RLS-context-aware inside
 * `withRlsContext` with `RLS_CONTEXT_INJECTION=true` — reusing rls.test.ts's
 * raw SET-LOCAL-ROLE harness would not exercise that same code path, so this
 * file drives the real production mechanism instead: `prismaAdmin` (bypasses
 * RLS, same client the app uses for cross-student/admin writes) sets up
 * fixtures, then each guarded function runs inside `withRlsContext` as the
 * fixture's own teacher, exactly as a `/teacher/connect` request would.
 *
 * Consent-scope contract note: `sendConnection` is gated on `ConsentRecord`
 * (scope `employer_referral`, src/lib/consent.ts); `sendPolicySms` is gated
 * on a *different* mechanism, `NotificationPreference.smsConsentAt`, not a
 * `ConsentRecord` row — the plan's "matching scope row" wording covers this
 * suite's real analogue of consent for that channel, not literally the same
 * table. Both must independently refuse an unconsented student, which is
 * exactly what `writes_without_scope` (floor 0) is counting.
 *
 * Prerequisites (auto-skipped if missing, same gate as rls.test.ts):
 *   - DATABASE_URL / ADMIN_DATABASE_URL point at a Postgres with every
 *     Connect migration applied (20260905100000-20260905140000) and RLS
 *     enforced for the DATABASE_URL role (i.e. it is `vq_app`, not a
 *     BYPASSRLS superuser — RLS is not evaluated at all for a role with
 *     BYPASSRLS, so this suite is meaningless against one).
 *   - RLS_TEST_ENABLED=true — opt-in because this test writes real fixture
 *     rows to the configured DB, same convention as rls.test.ts.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prismaAdmin } from "@/lib/db";
import { withRlsContext } from "@/lib/rls-context";
import { sendConnection, ConnectionError } from "@/lib/connect/connections";
import { sendPolicySms } from "@/lib/nudges/sms-policy";
import { selectBatchStudents } from "@/lib/connect/workforce-batch-query";

const SHOULD_RUN = process.env.RLS_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;

if (!SHOULD_RUN) {
  describe("consent scopes (integration) — SKIPPED", () => {
    it("requires RLS_TEST_ENABLED=true and DATABASE_URL pointing at a test DB", () => {
      assert.ok(
        true,
        "Set RLS_TEST_ENABLED=true and point DATABASE_URL/ADMIN_DATABASE_URL at a non-production DB with the Connect migrations applied.",
      );
    });
  });
} else {
  // RLS context injection is what makes `prisma` (the app singleton) apply
  // the caller's role/GUCs at all (src/lib/db.ts `rlsExtension`) — off by
  // default so unrelated tests never pay for it, and checked fresh on every
  // query rather than captured at import time, so setting it here (before
  // any test body runs) is sufficient.
  process.env.RLS_CONTEXT_INJECTION = "true";

  describe("consent scopes (integration)", () => {
    const suffix = `cs${Date.now().toString(36)}`;
    const ids = {
      teacher: `${suffix}-teacher`,
      studentConnect: `${suffix}-student-connect`,
      studentSms: `${suffix}-student-sms`,
      studentBatch: `${suffix}-student-batch`,
      classId: `${suffix}-class`,
      employerId: `${suffix}-employer`,
      leadConnectId: `${suffix}-lead-connect`,
      leadBatchId: `${suffix}-lead-batch`,
      connectionId: `${suffix}-connection`,
      orientationItemId: `${suffix}-orientation-item`,
      bhagGoalId: `${suffix}-bhag-goal`,
    };
    const N_CERTS = 16; // certsScore = round(16/19*25) = 21; see comment at fixture build.

    async function makeStudent(id: string, extra: Record<string, unknown> = {}) {
      await prismaAdmin.student.create({
        data: {
          id,
          studentId: id,
          displayName: `Consent Scopes Fixture ${id}`,
          role: "student",
          isActive: true,
          ...extra,
        },
      });
    }

    before(async () => {
      await prismaAdmin.student.create({
        data: {
          id: ids.teacher,
          studentId: ids.teacher,
          displayName: "Consent Scopes Fixture Teacher",
          role: "teacher",
          isActive: true,
        },
      });
      await makeStudent(ids.studentConnect);
      await makeStudent(ids.studentSms);
      await makeStudent(ids.studentBatch);

      await prismaAdmin.spokesClass.create({
        data: { id: ids.classId, name: `Consent Scopes Fixture Class ${suffix}`, code: `CSF-${suffix}` },
      });
      await prismaAdmin.spokesClassInstructor.create({
        data: { classId: ids.classId, instructorId: ids.teacher },
      });
      await prismaAdmin.studentClassEnrollment.createMany({
        data: [ids.studentConnect, ids.studentSms, ids.studentBatch].map((studentId) => ({
          classId: ids.classId,
          studentId,
          status: "active",
        })),
      });

      await prismaAdmin.employer.create({
        data: {
          id: ids.employerId,
          name: `Consent Scopes Fixture Employer ${suffix}`,
          nameKey: `consent-scopes-fixture-employer-${suffix}`,
          county: "Test County",
          city: "Test City",
          status: "active",
        },
      });
      await prismaAdmin.jobLead.create({
        data: {
          id: ids.leadConnectId,
          employerId: ids.employerId,
          employerName: `Consent Scopes Fixture Employer ${suffix}`,
          title: "Fixture Opening (connect)",
          location: "Test City, WV",
          source: "manual",
          status: "open",
        },
      });
      await prismaAdmin.jobLead.create({
        data: {
          id: ids.leadBatchId,
          employerId: ids.employerId,
          employerName: `Consent Scopes Fixture Employer ${suffix}`,
          title: "Fixture Opening (batch)",
          location: "Test City, WV",
          source: "manual",
          status: "open",
        },
      });

      // Connection ready to send: student-approved status, no ConsentRecord
      // for `employer_referral` was ever created for studentConnect.
      await prismaAdmin.connection.create({
        data: {
          id: ids.connectionId,
          studentId: ids.studentConnect,
          jobLeadId: ids.leadConnectId,
          employerId: ids.employerId,
          proposedById: ids.teacher,
          proposedVia: "teacher",
          status: "student_approved",
          packet: { resumeVersionId: null, coverLetterId: null, includedFields: [], includedCertIds: [] },
        },
      });

      // --- Readiness fixture for studentBatch (score must be >= 70 = READY_TO_WORK_SCORE,
      // so selectBatchStudents excludes them for lack of CONSENT specifically,
      // not for being unready — readiness is checked first in that function). ---
      await prismaAdmin.orientationItem.create({
        data: { id: ids.orientationItemId, label: `Consent Scopes Fixture Item ${suffix}` },
      });
      await prismaAdmin.orientationProgress.create({
        data: {
          studentId: ids.studentBatch,
          itemId: ids.orientationItemId,
          completed: true,
          completedAt: new Date(),
        },
      });
      await prismaAdmin.goal.create({
        data: {
          id: ids.bhagGoalId,
          studentId: ids.studentBatch,
          level: "bhag",
          content: "Fixture BHAG",
          status: "completed",
        },
      });
      await prismaAdmin.certification.createMany({
        data: Array.from({ length: N_CERTS }, (_, i) => ({
          studentId: ids.studentBatch,
          certType: `consent-scopes-fixture-cert-${suffix}-${i}`,
          status: "completed",
        })),
      });
      await prismaAdmin.portfolioItem.createMany({
        data: Array.from({ length: 4 }, (_, i) => ({
          studentId: ids.studentBatch,
          title: `Fixture Portfolio Item ${i}`,
        })),
      });
      await prismaAdmin.resumeData.create({
        data: { studentId: ids.studentBatch, data: "{}" },
      });
      await prismaAdmin.publicCredentialPage.create({
        data: { studentId: ids.studentBatch, slug: `consent-scopes-fixture-${suffix}`, isPublic: true },
      });
    });

    after(async () => {
      // Connection has Restrict FKs to Employer/JobLead/Student(proposedBy) —
      // delete it before any of those (Known Issues: "any e2e seed script
      // touching both Connection and Student needs to delete Connection rows
      // before Student rows").
      await prismaAdmin.connection.deleteMany({ where: { id: ids.connectionId } });
      await prismaAdmin.jobLead.deleteMany({ where: { id: { in: [ids.leadConnectId, ids.leadBatchId] } } });
      await prismaAdmin.employer.deleteMany({ where: { id: ids.employerId } });
      await prismaAdmin.certification.deleteMany({
        where: { studentId: ids.studentBatch, certType: { startsWith: `consent-scopes-fixture-cert-${suffix}-` } },
      });
      await prismaAdmin.portfolioItem.deleteMany({ where: { studentId: ids.studentBatch } });
      await prismaAdmin.resumeData.deleteMany({ where: { studentId: ids.studentBatch } });
      await prismaAdmin.publicCredentialPage.deleteMany({ where: { studentId: ids.studentBatch } });
      await prismaAdmin.goal.deleteMany({ where: { id: ids.bhagGoalId } });
      await prismaAdmin.orientationProgress.deleteMany({
        where: { studentId: ids.studentBatch, itemId: ids.orientationItemId },
      });
      await prismaAdmin.orientationItem.deleteMany({ where: { id: ids.orientationItemId } });
      await prismaAdmin.notificationPreference.deleteMany({ where: { studentId: ids.studentSms } });
      await prismaAdmin.studentClassEnrollment.deleteMany({ where: { classId: ids.classId } });
      await prismaAdmin.spokesClassInstructor.deleteMany({ where: { classId: ids.classId } });
      await prismaAdmin.spokesClass.deleteMany({ where: { id: ids.classId } });
      await prismaAdmin.student.deleteMany({
        where: { id: { in: [ids.teacher, ids.studentConnect, ids.studentSms, ids.studentBatch] } },
      });
    });

    it("sendConnection refuses a student with no employer_referral ConsentRecord", async () => {
      await withRlsContext(
        { userId: ids.teacher, role: "teacher", studentId: "" },
        async () => {
          await assert.rejects(
            () =>
              sendConnection(ids.connectionId, {
                senderId: ids.teacher,
                senderRole: "teacher",
                senderName: "Fixture Teacher",
                programName: "SPOKES (fixture)",
                programEmail: "fixture@example.invalid",
                baseUrl: "https://fixture.invalid",
              }),
            (error: unknown) => {
              assert.ok(error instanceof ConnectionError, `expected ConnectionError, got ${error}`);
              assert.match(
                (error as Error).message,
                /permission to share/i,
                `expected the consent-refusal message, got: ${(error as Error).message}`,
              );
              return true;
            },
          );
        },
      );
    });

    it("sendPolicySms refuses a student whose NotificationPreference has no smsConsentAt", async () => {
      await prismaAdmin.notificationPreference.create({
        data: {
          studentId: ids.studentSms,
          channel: "sms",
          enabled: true,
          destination: "+15555550100",
          // smsConsentAt intentionally omitted (null): never consented.
        },
      });

      const result = await sendPolicySms({
        studentId: ids.studentSms,
        templateKey: "consent-scopes-fixture",
        // Must satisfy sendPolicySms's own well-formed-body check (SMS_PREFIX
        // + SMS_STOP_SUFFIX, src/lib/nudges/sms-policy-shared.ts) so the
        // request reaches the consent check rather than failing earlier as
        // "malformed_body".
        body: "SPOKES: Fixture message for the consent-scopes suite. Reply STOP to stop.",
      });

      assert.equal(result.status, "refused");
      if (result.status === "refused") {
        assert.equal(result.reason, "no_consent");
      }

      const sentRows = await prismaAdmin.outboundMessage.count({
        where: { toKind: "student", toId: ids.studentSms, status: { in: ["sent", "queued"] } },
      });
      assert.equal(sentRows, 0, "no OutboundMessage row should have been reserved or sent");
    });

    it("selectBatchStudents excludes a ready-but-unconsented student from the WorkForce WV batch", async () => {
      await withRlsContext({ userId: ids.teacher, role: "teacher", studentId: "" }, async () => {
        const result = await selectBatchStudents(ids.classId);
        assert.ok(
          !result.includedIds.includes(ids.studentBatch),
          `studentBatch appeared in the exported batch with no employer_referral consent: ${JSON.stringify(result)}`,
        );
        // If this fails, either the readiness fixture above stopped clearing
        // READY_TO_WORK_SCORE (excludedNotReady would be the real reason,
        // not consent) or the consent gate itself regressed — both are worth
        // seeing, so assert the specific reason rather than only the outcome.
        assert.equal(
          result.excludedNoConsent,
          1,
          `expected exactly one exclusion for missing consent; got excludedNotReady=${result.excludedNotReady}, excludedNoConsent=${result.excludedNoConsent}`,
        );
      });
    });
  });
}
