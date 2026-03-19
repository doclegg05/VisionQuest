import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";
import { withErrorHandler, unauthorized, badRequest } from "@/lib/api-error";
import type { Prisma } from "@prisma/client";

const VALID_CATEGORIES = new Set([
  "ORIENTATION", "STUDENT_REFERRAL", "STUDENT_RESOURCE", "TEACHER_GUIDE",
  "TEACHER_LMS_SUPPORT", "LMS_PLATFORM_GUIDE", "CERTIFICATION_INFO",
  "CERTIFICATION_PREREQ", "DOHS_FORM", "PROGRAM_POLICY", "READY_TO_WORK",
  "SAGE_CONTEXT", "PRESENTATION",
]);

/**
 * GET /api/documents?category=ORIENTATION&platformId=aztec&search=welcome
 *
 * Lists active ProgramDocuments filtered by category, platformId,
 * certificationId, and/or text search. Audience-filtered by role:
 * students see STUDENT + BOTH; teachers see everything.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const platformId = searchParams.get("platformId");
  const certificationId = searchParams.get("certificationId");
  const search = searchParams.get("search")?.trim().slice(0, 100);

  if (category && !VALID_CATEGORIES.has(category)) throw badRequest("Invalid category");

  const isTeacher = session.role === "teacher";

  const where: Prisma.ProgramDocumentWhereInput = {
    isActive: true,
    // Students only see STUDENT + BOTH
    ...(!isTeacher && { audience: { in: ["STUDENT", "BOTH"] } }),
    ...(category && { category: category as Prisma.EnumProgramDocCategoryFilter }),
    ...(platformId && { platformId }),
    ...(certificationId && { certificationId }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: "insensitive" as const } },
        { description: { contains: search, mode: "insensitive" as const } },
      ],
    }),
  };

  // Normalize search for cache key to prevent cache fragmentation
  const normalizedSearch = search?.toLowerCase() || "";
  const cacheKey = `docs:${isTeacher ? "t" : "s"}:${category || ""}:${platformId || ""}:${certificationId || ""}:${normalizedSearch}`;

  const documents = await cached(cacheKey, 120, () =>
    prisma.programDocument.findMany({
      where,
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        mimeType: true,
        sizeBytes: true,
        category: true,
        audience: true,
        platformId: true,
        certificationId: true,
        sortOrder: true,
      },
    }),
  );

  return NextResponse.json({ documents });
});
