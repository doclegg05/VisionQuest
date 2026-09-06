import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";
import { rateLimit } from "@/lib/rate-limit";
import {
  withAuth,
  badRequest,
  rateLimited,
  isStaffRole,
} from "@/lib/api-error";
import type { Prisma } from "@prisma/client";

const VALID_CATEGORIES = new Set([
  "ORIENTATION", "STUDENT_REFERRAL", "STUDENT_RESOURCE", "TEACHER_GUIDE",
  "TEACHER_LMS_SUPPORT", "LMS_PLATFORM_GUIDE", "CERTIFICATION_INFO",
  "CERTIFICATION_PREREQ", "DOHS_FORM", "PROGRAM_POLICY", "READY_TO_WORK",
  "SAGE_CONTEXT", "PRESENTATION",
]);

/**
 * Hex characters kept from a cache-key segment's digest. 32 = 128 bits, the
 * same width `src/lib/rate-limit-key.ts` uses to bound a caller-sized row key.
 */
const CACHE_KEY_DIGEST_CHARS = 32;

/**
 * One caller-supplied cache-key segment, as a fixed-width digest. An absent
 * or empty value stays empty, so "no filter" keeps its own distinct key
 * rather than sharing one with a filter that happens to hash to zeroes.
 */
function keySegment(value: string | null | undefined): string {
  if (!value) return "";
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, CACHE_KEY_DIGEST_CHARS);
}

/**
 * GET /api/documents?category=ORIENTATION&platformId=aztec&search=welcome
 *
 * Lists active ProgramDocuments filtered by category, platformId,
 * certificationId, and/or text search. Audience-filtered by role:
 * students see STUDENT + BOTH; teachers see everything.
 */
export const GET = withAuth(async (session, req: Request) => {
  // 120 requests per minute per user
  const rl = await rateLimit(`docs:${session.id}`, 120, 60 * 1000);
  if (!rl.success) throw rateLimited();

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const platformId = searchParams.get("platformId");
  const certificationId = searchParams.get("certificationId");
  const search = searchParams.get("search")?.trim().slice(0, 100);

  // Pagination — bounded so no caller can request tens of thousands of rows.
  const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10);
  const rawOffset = parseInt(searchParams.get("offset") ?? "0", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

  if (category && !VALID_CATEGORIES.has(category)) throw badRequest("Invalid category");

  const isStaff = isStaffRole(session.role);

  const where: Prisma.ProgramDocumentWhereInput = {
    isActive: true,
    // Students only see STUDENT + BOTH
    ...(!isStaff && { audience: { in: ["STUDENT", "BOTH"] } }),
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

  // Every caller-sized segment of the cache key is a fixed-width digest.
  //
  // The raw values are caller-supplied and unvalidated: `search` is free
  // text, and `platformId`/`certificationId` come straight off the query
  // string with no allowlist behind them (unlike `category`, which is checked
  // against VALID_CATEGORIES above, and `limit`/`offset`, which are clamped to
  // numbers). Embedding any of them made the key grow with the input, which
  // is a cache-filling primitive: the shared cache is capped at 10,000 keys
  // and node-cache REFUSES to store rather than evicting, so filling it stops
  // every other `cached()` caller — getSession() included — from storing
  // anything.
  //
  // W4 (2026-09-06): `search` was already hashed; the other two were not.
  // One helper now covers all three, at the 32-hex width
  // src/lib/rate-limit-key.ts settled on for the same job — 128 bits, so a
  // collision needs ~2^64 distinct values, and one width means a reader does
  // not have to count characters to tell which segment is which. Widening
  // `search` from 16 to 32 changes its key once, costing one 120-second
  // cache miss per distinct search on deploy.
  const normalizedSearch = search?.toLowerCase() || "";
  const cacheKey = [
    "docs",
    isStaff ? "staff" : "student",
    category || "",
    keySegment(platformId),
    keySegment(certificationId),
    keySegment(normalizedSearch),
    limit,
    offset,
  ].join(":");

  const payload = await cached(cacheKey, 120, async () => {
    const [documents, total] = await Promise.all([
      prisma.programDocument.findMany({
        where,
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
        skip: offset,
        take: limit,
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
      prisma.programDocument.count({ where }),
    ]);
    return { documents, total };
  });

  return NextResponse.json({ ...payload, limit, offset });
});
