import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { downloadFile } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import {
  withErrorHandler,
  unauthorized,
  badRequest,
  notFound,
  rateLimited,
  isStaffRole,
} from "@/lib/api-error";

/**
 * GET /api/documents/download?id=<docId>&mode=view|download
 *
 * Downloads or views a ProgramDocument by ID.
 * - mode=view  (default) → Content-Disposition: inline  (opens in browser, printable)
 * - mode=download        → Content-Disposition: attachment (forces save dialog)
 *
 * Audience check: students cannot access TEACHER-only documents.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session) throw unauthorized();

  // 30 downloads per minute per user
  const rl = await rateLimit(`docs-dl:${session.id}`, 30, 60 * 1000);
  if (!rl.success) throw rateLimited();

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const mode = searchParams.get("mode") || "view";

  if (!id) throw badRequest("id is required");

  const doc = await prisma.programDocument.findUnique({
    where: { id },
    select: {
      storageKey: true,
      title: true,
      mimeType: true,
      audience: true,
      isActive: true,
    },
  });

  // Uniform 404 for missing, inactive, or unauthorized docs (no IDOR oracle)
  if (!doc || !doc.isActive) throw notFound("Document not found");
  if (!isStaffRole(session.role) && doc.audience === "TEACHER") {
    throw notFound("Document not found");
  }

  const result = await downloadFile(doc.storageKey);
  if (!result) {
    throw notFound("File not found in storage. Contact your instructor.");
  }

  // Derive a safe filename from the title + original extension
  const lastSegment = doc.storageKey.split("/").pop() ?? "";
  const ext = lastSegment.includes(".") ? lastSegment.split(".").pop()! : "pdf";
  const safeTitle = doc.title.replace(/[^a-zA-Z0-9._\- ]/g, "_").replace(/"+/g, "").replace(/\.+$/, "").slice(0, 200);
  const filename = `${safeTitle}.${ext}`;

  const disposition = mode === "download"
    ? `attachment; filename="${filename}"`
    : `inline; filename="${filename}"`;

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": doc.mimeType || result.mimeType,
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=3600",
    },
  });
});
