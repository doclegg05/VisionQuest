import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recomputeCertificationStatus } from "@/lib/certification-service";
import { validateRequirementUpdate } from "@/lib/certifications";
import { isValidUrl } from "@/lib/validation";
import { withAuth, badRequest, notFound } from "@/lib/api-error";
import { parseBody, deleteByIdSchema } from "@/lib/schemas";
import {
  PORTFOLIO_ITEM_TYPES,
  normalizePortfolioItemType,
  type PortfolioItemType,
} from "@/lib/portfolio";
import { recordCertificationEarned, recordPortfolioItem } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";
import { syncStudentAlerts } from "@/lib/advising";

const optionalCuidSchema = z.preprocess(
  (value) => value === "" ? null : value,
  z.string().cuid().optional().nullable(),
);

const optionalUrlSchema = z.preprocess(
  (value) => value === "" ? null : value,
  z.string().url().max(2000).optional().nullable(),
);

const portfolioTypeSchema = z.preprocess(
  (value) => normalizePortfolioItemType(value),
  z.enum(PORTFOLIO_ITEM_TYPES),
);

const portfolioCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  type: portfolioTypeSchema.optional(),
  fileId: optionalCuidSchema,
  url: optionalUrlSchema,
  certificationRequirementId: optionalCuidSchema,
});

const portfolioUpdateSchema = portfolioCreateSchema.partial().extend({
  id: z.string().cuid(),
});

// GET — list student's portfolio items
export const GET = withAuth(async (session) => {
  const items = await prisma.portfolioItem.findMany({
    where: { studentId: session.id },
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
  });

  return NextResponse.json({ items });
});

// POST — create a portfolio item
export const POST = withAuth(async (session, req: Request) => {
  const { title, description, type, fileId, url, certificationRequirementId } =
    await parseBody(req, portfolioCreateSchema);
  const itemType: PortfolioItemType = type || "project";

  if (url && !isValidUrl(url)) {
    throw badRequest("Invalid URL. Only http and https URLs are allowed");
  }

  if (certificationRequirementId && itemType !== "certification") {
    throw badRequest("Certification evidence can only be linked from a certification portfolio item.");
  }
  if (certificationRequirementId && !fileId) {
    throw badRequest("Attach the certification file before submitting it for Ready to Work review.");
  }

  // file ownership, certification ownership, and maxOrder are independent — run together.
  const [file, certificationRequirement, maxOrder] = await Promise.all([
    fileId
      ? prisma.fileUpload.findFirst({
          where: { id: fileId, studentId: session.id },
          select: { id: true },
        })
      : Promise.resolve(null),
    certificationRequirementId
      ? prisma.certRequirement.findFirst({
          where: { id: certificationRequirementId },
          include: {
            certification: true,
            template: {
              select: {
                id: true,
                certType: true,
                required: true,
                needsFile: true,
                needsVerify: true,
              },
            },
          },
        })
      : Promise.resolve(null),
    prisma.portfolioItem.aggregate({
      where: { studentId: session.id },
      _max: { sortOrder: true },
    }),
  ]);
  if (fileId && !file) throw notFound("Attached file was not found");
  if (
    certificationRequirementId &&
    (!certificationRequirement || certificationRequirement.certification.studentId !== session.id)
  ) {
    throw notFound("Certification requirement was not found");
  }

  if (certificationRequirement) {
    const validationError = validateRequirementUpdate(certificationRequirement.template, {
      templateId: certificationRequirement.templateId,
      completed: true,
      verifiedBy: certificationRequirement.verifiedBy,
      fileId: fileId || null,
    });
    if (validationError) throw badRequest(validationError);
  }

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.portfolioItem.create({
      data: {
        studentId: session.id,
        title,
        description: description || null,
        type: itemType,
        fileId: fileId || null,
        url: url || null,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    if (certificationRequirement) {
      await tx.certRequirement.update({
        where: { id: certificationRequirement.id },
        data: {
          completed: true,
          completedAt: certificationRequirement.completedAt || new Date(),
          fileId,
        },
      });
    }

    return created;
  });

  if (certificationRequirement) {
    const updatedCert = await recomputeCertificationStatus(
      certificationRequirement.certificationId,
      certificationRequirement.template.certType,
    );

    if (updatedCert.status === "completed") {
      try {
        await awardEvent({
          studentId: session.id,
          eventType: "cert_earned",
          sourceType: "certification",
          sourceId: certificationRequirement.certificationId,
          xp: 100,
          mutate: (state) => recordCertificationEarned(state),
        });
      } catch (err) {
        logger.error("Failed to record certification earned", { error: String(err) });
      }
    }
  }

  // Record portfolio progression
  try {
    const portfolioType = itemType === "resume" ? "resume" : "item";
    await awardEvent({
      studentId: session.id,
      eventType: "portfolio_item",
      sourceType: "portfolio",
      sourceId: item.id,
      xp: portfolioType === "resume" ? 50 : 15,
      mutate: (state) => recordPortfolioItem(state, portfolioType),
    });
  } catch (err) {
    logger.error("Failed to record portfolio progression", { error: String(err) });
  }

  await syncStudentAlerts(session.id);

  return NextResponse.json({ item });
});

// PUT — update a portfolio item
export const PUT = withAuth(async (session, req: Request) => {
  const { id, title, description, type, fileId, url } = await parseBody(req, portfolioUpdateSchema);

  // existing portfolio item and file ownership check are independent.
  const [existing, file] = await Promise.all([
    prisma.portfolioItem.findFirst({ where: { id, studentId: session.id } }),
    fileId
      ? prisma.fileUpload.findFirst({
          where: { id: fileId, studentId: session.id },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  if (!existing) throw notFound("Not found");
  if (url && !isValidUrl(url)) {
    throw badRequest("Invalid URL. Only http and https URLs are allowed");
  }
  if (fileId && !file) throw notFound("Attached file was not found");

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description || null;
  if (type !== undefined) data.type = type;
  if (fileId !== undefined) data.fileId = fileId || null;
  if (url !== undefined) data.url = url || null;

  const item = await prisma.portfolioItem.update({ where: { id }, data });
  await syncStudentAlerts(session.id);
  return NextResponse.json({ item });
});

// DELETE — remove a portfolio item
export const DELETE = withAuth(async (session, req: Request) => {
  const { id } = await parseBody(req, deleteByIdSchema);

  const existing = await prisma.portfolioItem.findFirst({
    where: { id, studentId: session.id },
  });
  if (!existing) throw notFound("Not found");

  await prisma.portfolioItem.delete({ where: { id } });
  await syncStudentAlerts(session.id);
  return NextResponse.json({ ok: true });
});
