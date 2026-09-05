import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { PACKET_FIELD_LABELS } from "../src/lib/connect/packet-shared";
import { BENCH_CLASS, BENCH_INSTRUCTOR, BENCH_JOURNEY_STUDENT } from "./bench-fixtures";
import { loginContext } from "./helpers/auth";
import { createPrisma } from "./helpers/db";

/**
 * The Connect introduction, end to end, in a browser:
 *
 *   instructor proposes → student approves at 375 px → instructor sends →
 *   employer opens the emailed link → employer picks a time → employer hires →
 *   a verified Application and a placement queue item exist.
 *
 * This is the only test in the repository that covers the whole path a
 * student's information takes out of the program and the placement record it
 * produces coming back. Every step in between is covered by unit tests; none of
 * them can tell you the six steps compose.
 *
 * It also MEASURES, which is why it writes a JSON file rather than only
 * asserting. `scripts/bench/suites/connect-journey.mjs` reads it and scores two
 * numbers: how many taps the STUDENT side costs (the design's floor is 12 or
 * fewer) and whether the journey completed at all. A tap count nobody watches
 * grows one button at a time.
 *
 * Requires:
 *   npx tsx scripts/bench/seed-cohort.ts          # the 50-student cohort
 *   EMAIL_SINK_DIR=<dir>                          # on the SERVER, see below
 *
 * WHY AN EMAIL SINK. The employer's response link is a capability token that
 * appears in exactly one place — the email — and is stored only as a sha256
 * hash. Nothing else in the system can recover it, so without reading what was
 * sent there is no way for a browser to open the page an employer opens. The
 * sink is refused in production (src/lib/email.ts).
 */

const SINK_DIR = process.env.EMAIL_SINK_DIR ?? path.join(process.cwd(), ".bench-outbox");
const REPORT_PATH =
  process.env.BENCH_JOURNEY_REPORT ??
  path.join(process.cwd(), "reports", "benchmarks", "raw", "connect-journey.json");

/**
 * The lead this journey introduces the student to, resolved at run time rather
 * than hardcoded.
 *
 * It has to satisfy four things at once, and picking one by eye got two of them
 * wrong: open, attached to the student's OWN class, with a contact who has an
 * email and is not marked do-not-contact. The class one is the subtle one —
 * `resolveEmployerLink` checks the pilot flag against the LEAD's class, so a
 * lead belonging to another class produces a working send and then the neutral
 * "no longer active" page for the employer, which looks like a broken link
 * rather than a mis-picked fixture.
 */
async function resolveLeadId(prisma: ReturnType<typeof createPrisma>): Promise<string> {
  const lead = await prisma.jobLead.findFirst({
    where: {
      id: { startsWith: "cbench" },
      status: "open",
      classId: BENCH_CLASS.id,
      contact: { email: { not: null }, doNotContactAt: null },
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!lead) {
    throw new Error(
      `No open ${BENCH_CLASS.code} lead with a contactable employer — run: ` +
        "npx tsx scripts/bench/seed-cohort.ts",
    );
  }
  return lead.id;
}

interface OutboxLine {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

function readOutbox(): OutboxLine[] {
  try {
    return readFileSync(path.join(SINK_DIR, "outbox.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as OutboxLine);
  } catch {
    return [];
  }
}

/**
 * The token out of the employer email.
 *
 * Parsed from the body rather than read from the database, because the database
 * only has its hash — which is the property being relied on, so recovering the
 * token any other way would quietly stop testing it.
 */
function tokenFromEmail(line: OutboxLine): string {
  const match = line.text.match(/\/connect\/([A-Za-z0-9_-]{16,})/u);
  if (!match) throw new Error(`No /connect/<token> link in the employer email:\n${line.text}`);
  return match[1];
}

test("Connect journey: propose → approve → send → employer views, books, hires", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const prisma = createPrisma();
  const started = Date.now();
  let leadId = "";
  /** Every tap the STUDENT makes. The employer and the instructor are not students. */
  let studentTaps = 0;
  let connectionId: string | null = null;
  /**
   * What `connect_enabled_classes` and `placement_bridge_classes` said before
   * this spec touched them. `null` means the row did not exist.
   *
   * These are PROGRAM-WIDE rows, not per-test fixtures: the upsert below
   * REPLACES whichever classes the pilot had open with the bench class alone.
   * Leaving that in place would close Connect for every real class, silently,
   * as a side effect of running a benchmark.
   */
  const configBefore = new Map<string, string | null>();

  try {
    // ── Preconditions ────────────────────────────────────────────────────
    const student = await prisma.student.findUnique({
      where: { id: BENCH_JOURNEY_STUDENT.id },
      select: { id: true },
    });
    if (!student) {
      throw new Error(
        `${BENCH_JOURNEY_STUDENT.id} is missing — run: npx tsx scripts/bench/seed-cohort.ts`,
      );
    }

    // Connect must be on for the class, and the subsidy lines stay off (they
    // are gated on WV Works sign-off, P0.8, and this journey must not depend
    // on a decision nobody has made).
    //
    // `placement_bridge_classes` too: the bridge is default-off, so without it
    // the hire produces a verified Application and NO queue item, and the last
    // assertion below would fail against a working product.
    for (const key of ["connect_enabled_classes", "placement_bridge_classes"]) {
      const existing = await prisma.systemConfig.findUnique({
        where: { key },
        select: { value: true },
      });
      configBefore.set(key, existing?.value ?? null);
      await prisma.systemConfig.upsert({
        where: { key },
        update: { value: BENCH_CLASS.id, updatedBy: "bench-connect-journey" },
        create: { key, value: BENCH_CLASS.id, updatedBy: "bench-connect-journey" },
      });
    }

    leadId = await resolveLeadId(prisma);

    // A clean slate for THIS pair only. The cohort seeds `cbenchconn01` for
    // this student against a different lead; the journey proposes its own, and
    // a leftover from a previous run would collide on (studentId, jobLeadId).
    await prisma.connectionEvent.deleteMany({
      where: { connection: { studentId: BENCH_JOURNEY_STUDENT.id, jobLeadId: leadId } },
    });
    await prisma.connection.deleteMany({
      where: { studentId: BENCH_JOURNEY_STUDENT.id, jobLeadId: leadId },
    });
    rmSync(SINK_DIR, { recursive: true, force: true });

    // ── 1. The instructor proposes ───────────────────────────────────────
    const staff = await loginContext(browser, BENCH_INSTRUCTOR);
    try {
      const proposal = await staff.request.post("/api/teacher/connect/connections", {
        data: {
          studentId: BENCH_JOURNEY_STUDENT.id,
          jobLeadId: leadId,
          endorsement: "Alma came to every class on time and finished the work.",
        },
        headers: { Origin: process.env.BASE_URL ?? "http://localhost:3000" },
      });
      expect(
        proposal.ok(),
        `propose failed: ${proposal.status()} ${await proposal.text()}`,
      ).toBe(true);

      const created = await prisma.connection.findFirst({
        where: { studentId: BENCH_JOURNEY_STUDENT.id, jobLeadId: leadId },
        select: { id: true, status: true },
      });
      expect(created, "the proposal wrote no Connection row").toBeTruthy();
      expect(created!.status).toBe("proposed");
      connectionId = created!.id;

      // ── 2. The student approves, at 375 px ─────────────────────────────
      const studentContext = await browser.newContext({
        baseURL: process.env.BASE_URL ?? "http://localhost:3000",
        viewport: { width: 375, height: 812 },
      });
      try {
        const loginResponse = await studentContext.request.post("/api/auth/login", {
          data: {
            studentId: BENCH_JOURNEY_STUDENT.login,
            password: BENCH_JOURNEY_STUDENT.password,
          },
          headers: { Origin: process.env.BASE_URL ?? "http://localhost:3000" },
        });
        expect(loginResponse.ok(), "student login failed").toBe(true);

        const page = await studentContext.newPage();
        // Tap 1: opening Career. Counted because a student on their dashboard
        // has to get here, and the design's floor is about the whole path.
        await page.goto("/career");
        studentTaps += 1;

        const approve = page.getByRole("button", { name: "OK, send it" });
        await expect(approve).toBeVisible({ timeout: 20_000 });

        // The consent claim: the exact field list is on screen BEFORE the tap.
        // A journey that approved without seeing it would pass while the
        // product's whole disclosure story was broken. Both halves are checked
        // — the heading that names the disclosure, and the list itself, whose
        // first entry is always the candidate name.
        await expect(page.getByText("This is what they would get:")).toBeVisible();
        await expect(
          page.getByText(PACKET_FIELD_LABELS.candidate_name).first(),
        ).toBeVisible();

        // Tap 2: the approval itself.
        await approve.click();
        studentTaps += 1;

        await expect
          .poll(
            async () =>
              (
                await prisma.connection.findUnique({
                  where: { id: connectionId! },
                  select: { status: true },
                })
              )?.status,
            { timeout: 20_000 },
          )
          .toBe("student_approved");
      } finally {
        await studentContext.close();
      }

      // ── 3. The instructor sends ────────────────────────────────────────
      const send = await staff.request.post(
        `/api/teacher/connect/connections/${connectionId}/send`,
        { headers: { Origin: process.env.BASE_URL ?? "http://localhost:3000" } },
      );
      expect(send.ok(), `send failed: ${send.status()} ${await send.text()}`).toBe(true);

      // ── 4. The employer opens the link ─────────────────────────────────
      const outbox = readOutbox();
      expect(
        outbox.length,
        "no email reached the sink — is EMAIL_SINK_DIR set on the SERVER process?",
      ).toBeGreaterThan(0);
      const token = tokenFromEmail(outbox[outbox.length - 1]);

      // A fresh context with no cookies: an employer has no account here, and
      // reusing the instructor's session would hide a route that leaned on one.
      const employer = await browser.newContext({
        baseURL: process.env.BASE_URL ?? "http://localhost:3000",
      });
      try {
        const employerPage = await employer.newPage();
        await employerPage.goto(`/connect/${token}`);

        await expect(
          employerPage.getByRole("button", { name: "I want to meet them" }),
        ).toBeVisible({ timeout: 20_000 });
        // Their name is the first initial form, never the full surname.
        await expect(employerPage.getByText(/Alma A\./u).first()).toBeVisible();

        // ── 5. Interested, with a time ───────────────────────────────────
        await employerPage.getByRole("button", { name: "I want to meet them" }).click();
        await expect(
          employerPage.getByRole("heading", { name: "Pick a time to meet" }),
        ).toBeVisible();

        const slot = employerPage.getByRole("button", { name: /\d{1,2}:\d{2}/u }).first();
        await expect(
          slot,
          "no bookable slot — does the instructor have AdvisorAvailability seeded?",
        ).toBeVisible({ timeout: 20_000 });
        await slot.click();

        await expect
          .poll(
            async () =>
              (
                await prisma.connection.findUnique({
                  where: { id: connectionId! },
                  select: { status: true },
                })
              )?.status,
            { timeout: 20_000 },
          )
          .toBe("interview_scheduled");

        // ── 6. Hired ─────────────────────────────────────────────────────
        await employerPage.goto(`/connect/${token}`);
        await employerPage.getByRole("button", { name: "I hired them" }).click();
        await employerPage.locator("#hired-start").fill(new Date().toISOString().slice(0, 10));
        await employerPage.locator("#hired-wage").fill("16");
        await employerPage.getByRole("button", { name: "Send" }).click();

        await expect
          .poll(
            async () =>
              (
                await prisma.connection.findUnique({
                  where: { id: connectionId! },
                  select: { status: true },
                })
              )?.status,
            { timeout: 20_000 },
          )
          .toBe("hired");
      } finally {
        await employer.close();
      }

      // ── 7. What the hire must have produced ────────────────────────────
      const hired = await prisma.connection.findUnique({
        where: { id: connectionId! },
        select: { applicationId: true, hiredAt: true, studentId: true },
      });
      expect(hired?.hiredAt, "a hire with no hiredAt").toBeTruthy();
      expect(hired?.applicationId, "a hire that produced no Application").toBeTruthy();

      const application = await prisma.application.findUnique({
        where: { id: hired!.applicationId! },
        select: { status: true, verificationStatus: true },
      });
      // Accepted AND verified. `qualifiesForPlacement` needs both, and a
      // self-reported hire would not reach the grant KPI report at all.
      expect(application?.status).toBe("accepted");
      expect(application?.verificationStatus).toBe("verified");

      const alert = await prisma.studentAlert.findFirst({
        where: { studentId: BENCH_JOURNEY_STUDENT.id, type: "placement_outcome_pending" },
        select: { id: true },
      });
      expect(
        alert,
        "the placement bridge raised no queue item — is placement_bridge_classes open for this class?",
      ).toBeTruthy();
    } finally {
      await staff.close();
    }

    // ── The measurement ──────────────────────────────────────────────────
    mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    writeFileSync(
      REPORT_PATH,
      `${JSON.stringify(
        {
          completed: 1,
          studentTaps,
          elapsedMs: Date.now() - started,
          connectionId,
          measuredAt: new Date().toISOString(),
          note:
            "studentTaps counts only what the STUDENT does. The instructor's and the " +
            "employer's steps are real work by other people and are not what the design's " +
            "12-tap floor is about.",
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    // Clean up THIS journey's rows. The cohort's own rows stay — they are the
    // shared fixture, and `scripts/bench/seed-cohort.ts --reset` owns those.
    if (connectionId) {
      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
        select: { applicationId: true, interviewAppointmentId: true },
      });
      await prisma.connectionEvent.deleteMany({ where: { connectionId } });
      await prisma.outboundMessage.deleteMany({ where: { connectionId } });
      await prisma.connection.delete({ where: { id: connectionId } }).catch(() => undefined);
      if (connection?.applicationId) {
        await prisma.spokesRecord.updateMany({
          where: { placementApplicationId: connection.applicationId },
          data: { placementApplicationId: null },
        });
        await prisma.application
          .delete({ where: { id: connection.applicationId } })
          .catch(() => undefined);
      }
      if (connection?.interviewAppointmentId) {
        await prisma.appointment
          .delete({ where: { id: connection.interviewAppointmentId } })
          .catch(() => undefined);
      }
    }
    await prisma.studentAlert.deleteMany({
      where: { studentId: BENCH_JOURNEY_STUDENT.id, type: "placement_outcome_pending" },
    });

    // Put the two flags back exactly as they were, including "did not exist" —
    // a spec that leaves a feature flag flipped has changed the product, not
    // measured it.
    for (const [key, value] of configBefore) {
      if (value === null) {
        await prisma.systemConfig.deleteMany({ where: { key } });
      } else {
        await prisma.systemConfig.update({
          where: { key },
          data: { value, updatedBy: "bench-connect-journey" },
        });
      }
    }

    rmSync(SINK_DIR, { recursive: true, force: true });
    await prisma.$disconnect();
  }
});
