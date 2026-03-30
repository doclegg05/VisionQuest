import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { invalidatePrefix } from "@/lib/cache";
import { logAuditEvent } from "@/lib/audit";

/**
 * GET — List all program documents with their Sage context status.
 * Teachers use this to see which documents are feeding Sage's knowledge.
 */
export const GET = withTeacherAuth(async () => {
  const documents = await prisma.programDocument.findMany({
    where: { isActive: true },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      certificationId: true,
      platformId: true,
      usedBySage: true,
      sageContextNote: true,
    },
    orderBy: [{ usedBySage: "desc" }, { title: "asc" }],
  });

  return NextResponse.json({ documents });
});

/**
 * PATCH — Toggle usedBySage and/or edit sageContextNote for a document.
 *
 * Body: { documentId: string, usedBySage?: boolean, sageContextNote?: string }
 */
export const PATCH = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json();

  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
  if (!documentId) {
    return NextResponse.json({ error: "documentId is required." }, { status: 400 });
  }

  const existing = await prisma.programDocument.findUnique({
    where: { id: documentId },
    select: { id: true, title: true, isActive: true },
  });

  if (!existing || !existing.isActive) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const updates: { usedBySage?: boolean; sageContextNote?: string } = {};

  if (typeof body.usedBySage === "boolean") {
    updates.usedBySage = body.usedBySage;
  }

  if (typeof body.sageContextNote === "string") {
    updates.sageContextNote = body.sageContextNote.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided." }, { status: 400 });
  }

  const updated = await prisma.programDocument.update({
    where: { id: documentId },
    data: updates,
    select: {
      id: true,
      title: true,
      usedBySage: true,
      sageContextNote: true,
    },
  });

  // Bust the cached Sage documents list so next chat picks up changes
  invalidatePrefix("sage:documents");

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "document.sage_context_updated",
    targetType: "program_document",
    targetId: documentId,
    summary: `Updated Sage context for "${existing.title}".`,
    metadata: { fields: Object.keys(updates) },
  });

  return NextResponse.json({ document: updated });
});
