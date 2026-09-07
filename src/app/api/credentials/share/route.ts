import { NextResponse } from "next/server";
import { syncStudentAlerts } from "@/lib/advising";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";
import { parseBody, shareCredentialSchema } from "@/lib/schemas";
import { READY_TO_WORK_FAMILY_CERT_TYPES } from "@/lib/certifications";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function ensureUniqueSlug(base: string) {
  const root = base || "credential";
  let suffix = 0;

  while (true) {
    const candidate = suffix === 0 ? root : `${root}-${suffix}`;
    const existing = await prisma.publicCredentialPage.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    suffix += 1;
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
  const slug = existing?.slug || await ensureUniqueSlug(slugify(session.studentId));

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
