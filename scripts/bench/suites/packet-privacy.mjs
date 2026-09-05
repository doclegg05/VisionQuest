#!/usr/bin/env node
// =============================================================================
// packet-privacy — what actually leaves the program.
//
// A Connection is the only object in VisionQuest that causes a student's
// information to leave it. Three surfaces carry that information outward, and
// each is written by different code:
//
//   1. the employer response page at /connect/[token], rendered here for real;
//   2. the employer email, built by the real `buildEmployerEmail`;
//   3. the résumé content the packet PDF carries, from `packetResumeContent`.
//
// All three are scanned against one denylist — the union of the two the unit
// tests already pin (packet-shared.test.ts, workforce-batch.test.ts) — plus
// phone, email and ZIP patterns. `forbidden_fields_found` has a floor of 0 and
// an exact match, because there is no acceptable non-zero value for "a
// student's phone number reached an employer".
//
// WHY A DATABASE. `assemblePacket` is the function whose allowlist decides what
// a packet contains, and it reads the student and the lead itself. Building a
// packet by hand here would test a copy of the rule rather than the rule, which
// is precisely the failure the equivalence test in packet-equivalence.test.tsx
// exists to prevent between two rendering surfaces.
//
// WHY NOTHING IS MOCKED. `assemblePacket` calls the AI to tailor a résumé —
// unless one already exists for this (student, lead) pair, in which case it
// reuses it. Seeding a ResumeVersion takes that branch, so there is no AI call
// and no module to stub. The résumé tailoring is "mocked" by giving the real
// code the real thing it looks for first.
//
//   DATABASE_URL=postgres://…/visionquest_local \
//     node --import tsx scripts/bench/suites/packet-privacy.mjs --self-test
// =============================================================================

import { loadCohort } from "../lib/cohort.mjs";
import { isSelfTest, selfTest } from "../lib/self-test.mjs";

const SUITE = "packet-privacy";

/** The scanned surfaces, so a hit says WHICH one leaked. */
const SURFACES = ["employer_page", "employer_email", "packet_pdf_resume"];

export async function run(ctx) {
  const databaseUrl = ctx.env.databaseUrl;
  if (!databaseUrl) {
    return { skipped: "no DATABASE_URL — this suite writes packets to a seeded database" };
  }

  const { isSafeE2eSeedTarget } = await import("../../../src/lib/e2e-seed-guard.ts");
  const target = isSafeE2eSeedTarget(databaseUrl);
  if (!target.allowed) {
    // Refuse rather than skip: a suite that writes ResumeVersion rows and
    // rewrites connection tokens must never do so against a database it was
    // not meant to touch, and "skipped" would hide that it was pointed at one.
    throw new Error(
      `packet-privacy writes to the database and refuses host "${target.host}" ` +
        `(database "${target.database}"), which is neither local nor CI-scoped.`,
    );
  }

  // The admin client is what the employer page resolves its token through, and
  // it reads ADMIN_DATABASE_URL. Point both at the same seeded database before
  // any of the modules below initialize a client.
  process.env.DATABASE_URL = databaseUrl;
  process.env.ADMIN_DATABASE_URL = databaseUrl;

  const { renderToString } = await import("react-dom/server");
  const { prisma } = await import("../../../src/lib/db.ts");
  const { assemblePacket, packetResumeContent } = await import(
    "../../../src/lib/connect/packet.ts"
  );
  const { buildEmployerEmail } = await import("../../../src/lib/connect/employer-email.ts");
  const { mintEmployerToken } = await import(
    "../../../src/lib/connect/employer-link-shared.ts"
  );
  const { parseStoredResumeData } = await import("../../../src/lib/resume.ts");
  const { setPlainConfigValue } = await import("../../../src/lib/system-config.ts");
  const EmployerConnectPage = (await import("../../../src/app/connect/[token]/page.tsx")).default;

  const cohort = loadCohort();
  const fixture = ctx.fixture;

  // The page refuses every token when Connect is off for the lead's class, and
  // would then render the neutral "no longer active" card for all twenty —
  // scanning nothing while reporting a clean sweep.
  await setPlainConfigValue(
    "connect_enabled_classes",
    "all",
    "packet-privacy benchmark (local/CI database only)",
  );

  const patterns = fixture.patterns.map((entry) => ({
    ...entry,
    compiled: new RegExp(entry.regex, "gu"),
  }));

  const findings = [];
  let scanned = 0;

  function scan(surface, connectionId, text) {
    scanned += 1;
    for (const term of fixture.forbiddenTerms) {
      if (text.toLowerCase().includes(term.toLowerCase())) {
        findings.push({ surface, connectionId, kind: "term", detail: term });
      }
    }
    for (const pattern of patterns) {
      pattern.compiled.lastIndex = 0;
      for (const match of text.matchAll(pattern.compiled)) {
        if ((pattern.allow ?? []).includes(match[0])) continue;
        findings.push({
          surface,
          connectionId,
          kind: pattern.id,
          detail: match[0],
          why: pattern.why,
        });
      }
    }
  }

  try {
    for (const connection of cohort.connections) {
      const lead = cohort.leadById.get(connection.jobLeadId);
      const student = cohort.studentById.get(connection.studentId);

      // Take assemblePacket's REUSE branch: with a ResumeVersion already there
      // for this (student, lead) pair it never reaches the tailoring call, so
      // no AI is contacted and no module is stubbed.
      const resumeVersionId = `bench_rv_${connection.id}`;
      const stored = await prisma.resumeData.findUnique({
        where: { studentId: connection.studentId },
        select: { data: true },
      });
      const resume = parseStoredResumeData(stored?.data ?? null);
      await prisma.resumeVersion.upsert({
        where: { id: resumeVersionId },
        update: {},
        create: {
          id: resumeVersionId,
          studentId: connection.studentId,
          jobLeadId: connection.jobLeadId,
          version: 1,
          content: resume,
        },
      });

      const packet = await assemblePacket(
        { studentId: connection.studentId, jobLeadId: connection.jobLeadId },
        {
          endorsement:
            `${student.firstName} came to every class on time and finished the work.`,
        },
      );

      // --- surface 2: the employer email ---
      const email = buildEmployerEmail({
        packet,
        contactName: cohort.contactByEmployerId.get(connection.employerId).name,
        jobTitle: lead.title,
        employerName: lead.employerName,
        instructorName: fixture.instructorName,
        programEmail: fixture.programEmail,
        programName: fixture.programName,
        responseUrl: "https://bench.example.invalid/connect/tttttttttttttttttttttttt",
      });
      scan("employer_email", connection.id, `${email.subject}\n${email.text}`);

      // --- surface 3: the résumé the PDF carries ---
      scan(
        "packet_pdf_resume",
        connection.id,
        JSON.stringify(packetResumeContent(resume)),
      );

      // --- surface 1: the employer page, rendered ---
      //
      // Through a real minted token against a real row, not a stubbed
      // `resolveEmployerLink`. The page's job is to obey `includedFields`, and
      // a stub would have handed it exactly the view model the test expected.
      const { token, tokenHash, expiresAt } = mintEmployerToken(new Date());
      await prisma.connection.update({
        where: { id: connection.id },
        data: {
          status: "sent",
          packet,
          employerTokenHash: tokenHash,
          tokenExpiresAt: expiresAt,
          sentById: connection.proposedById,
        },
      });

      const html = renderToString(
        await EmployerConnectPage({ params: Promise.resolve({ token }) }),
      );
      if (html.includes("no longer active")) {
        // Loud, not silent. A neutral page contains none of the packet, so a
        // run that rendered twenty of them would report zero findings while
        // having scanned nothing at all.
        findings.push({
          surface: "employer_page",
          connectionId: connection.id,
          kind: "not_rendered",
          detail: "the employer page resolved to the neutral inactive card",
        });
        continue;
      }
      scan("employer_page", connection.id, html);
    }
  } finally {
    await prisma.$disconnect();
  }

  return {
    metrics: [
      {
        id: "forbidden_fields_found",
        value: findings.length,
        n: scanned,
        details: {
          findings: findings.slice(0, 30),
          surfaces: SURFACES,
          connections: cohort.connections.length,
        },
      },
      {
        id: "surfaces_scanned",
        value: scanned,
        n: cohort.connections.length * SURFACES.length,
      },
    ],
  };
}

if (isSelfTest(import.meta.url)) await selfTest(SUITE, run);
