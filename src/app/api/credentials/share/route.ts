import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [page, certification] = await Promise.all([
    prisma.publicCredentialPage.findUnique({
      where: { studentId: session.id },
    }),
    prisma.certification.findUnique({
      where: {
        studentId_certType: {
          studentId: session.id,
          certType: "ready-to-work",
        },
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
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const isPublic = Boolean(body.isPublic);
  const headline = typeof body.headline === "string" ? body.headline.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";

  const certification = await prisma.certification.findUnique({
    where: {
      studentId_certType: {
        studentId: session.id,
        certType: "ready-to-work",
      },
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

  const baseUrl = process.env.APP_BASE_URL || new URL(req.url).origin;

  return NextResponse.json({
    eligible,
    page,
    publicUrl: `${baseUrl}/credentials/${page.slug}`,
  });
}
