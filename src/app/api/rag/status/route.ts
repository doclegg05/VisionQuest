import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";

/**
 * GET /api/rag/status
 *
 * Teacher-only endpoint to check ingestion status of uploaded documents.
 * Optional query param: `sourceDocumentId` to fetch a single document.
 * Without it, returns all documents uploaded by the current teacher.
 */
export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sourceDocumentId = url.searchParams.get("sourceDocumentId");

  if (sourceDocumentId) {
    const doc = await prisma.sourceDocument.findFirst({
      where: {
        id: sourceDocumentId,
        uploadedBy: session.id,
      },
    });

    if (!doc) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 },
      );
    }

    const chunksCreated = await prisma.contentChunk.count({
      where: { sourceDocumentId: doc.id },
    });

    return NextResponse.json({
      success: true,
      data: [
        {
          sourceDocumentId: doc.id,
          title: doc.title,
          ingestionStatus: doc.ingestionStatus,
          chunksCreated,
          lastIngestedAt: doc.lastIngestedAt,
          ingestionError: doc.ingestionError,
        },
      ],
    });
  }

  // Fetch all documents uploaded by this teacher
  const docs = await prisma.sourceDocument.findMany({
    where: { uploadedBy: session.id },
    orderBy: { createdAt: "desc" },
  });

  const data = await Promise.all(
    docs.map(async (doc) => {
      const chunksCreated = await prisma.contentChunk.count({
        where: { sourceDocumentId: doc.id },
      });

      return {
        sourceDocumentId: doc.id,
        title: doc.title,
        ingestionStatus: doc.ingestionStatus,
        chunksCreated,
        lastIngestedAt: doc.lastIngestedAt,
        ingestionError: doc.ingestionError,
      };
    }),
  );

  return NextResponse.json({ success: true, data });
});
