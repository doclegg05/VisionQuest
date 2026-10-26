import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { syncStudentAlerts } from "@/lib/advising";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";
import { assertNotDemoAccount } from "@/lib/demo/guards";
import { DEMO_PUBLIC_PAGE_REFUSAL } from "@/lib/demo/copy";
import { parseBody, shareCredentialSchema } from "@/lib/schemas";
import { READY_TO_WORK_FAMILY_CERT_TYPES } from "@/lib/certifications";

/**
 * The slug is the only thing between the public /credentials/[slug] page and
 * anyone who wants to list participants, so it is random, never derived from
 * the student. It used to be the slugified login username, which put half of
 * the account's credentials in every shared link and made pages guessable.
 * Hex keeps the alphabet inside the old slugs' `[a-z0-9-]`. 12 bytes = 96 bits.
 */
const SLUG_BYTES = 12;

async function ensureUniqueSlug() {
  while (true) {
    const candidate = randomBytes(SLUG_BYTES).toString("hex");
    const existing = await prisma.publicCredentialPage.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
}

export const GET = withAuth(async (session, req: Request) => {
  const [page, certification] = await Promise.all([
    prisma.publicCredentialPage.findUnique({
      where: { studentId: session.id },
    }),
    // D7 (2026-09-07): the Ready-to-Work FAMILY, not an exact
    // "ready-to-work" match — a Certification row created under a catalog
    // certId (e.g. "workkeys-ncrc") is still the student's Ready-to-Work
    // credential.
    prisma.certification.findFirst({
      where: {
        studentId: session.id,
        certType: { in: [...READY_TO_WORK_FAMILY_CERT_TYPES] },
      },
      select: {
        id: true,
        status: true,
        completedAt: true,
      },
    }),
  ]);

  const baseUrl = process.env.APP_BASE_URL || new URL(req.url).origin;

  return NextResponse.json({
    eligible: certification?.status === "completed",
    certification,
    page,
    publicUrl: page ? `${baseUrl}/credentials/${page.slug}` : null,
  });
});

export const POST = withAuth(async (session, req: Request) => {
  // Before the body is read: a public page is reachable by anyone with the link.
  assertNotDemoAccount(session, DEMO_PUBLIC_PAGE_REFUSAL);

  const { isPublic, headline, summary } = await parseBody(req, shareCredentialSchema);

  // D7 (2026-09-07): same family lookup as GET, above.
  const certification = await prisma.certification.findFirst({
    where: {
      studentId: session.id,
      certType: { in: [...READY_TO_WORK_FAMILY_CERT_TYPES] },
    },
    select: {
      id: true,
      status: true,
      completedAt: true,
    },
  });

  const eligible = certification?.status === "completed";
  if (isPublic && !eligible) {
    return NextResponse.json({ error: "You can only publish a credential after completing certification." }, { status: 400 });
  }

  const existing = await prisma.publicCredentialPage.findUnique({
    where: { studentId: session.id },
  });
  const slug = existing?.slug || await ensureUniqueSlug();

  const page = await prisma.publicCredentialPage.upsert({
    where: { studentId: session.id },
    update: {
      headline: headline || null,
      summary: summary || null,
      isPublic: eligible ? isPublic : false,
    },
    create: {
      studentId: session.id,
      slug,
      headline: headline || null,
      summary: summary || null,
      isPublic: eligible ? isPublic : false,
    },
  });

  await syncStudentAlerts(session.id);

  const baseUrl = process.env.APP_BASE_URL || new URL(req.url).origin;

  return NextResponse.json({
    eligible,
    page,
    publicUrl: `${baseUrl}/credentials/${page.slug}`,
  });
});
