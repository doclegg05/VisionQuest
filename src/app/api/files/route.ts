import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateStorageKey, uploadFile, deleteFile, validateFile } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { ApiError, withAuth, badRequest, notFound } from "@/lib/api-error";
import { parseBody, deleteFileSchema } from "@/lib/schemas";

// GET — list student's files
export const GET = withAuth(async (session) => {
  const files = await prisma.fileUpload.findMany({
    where: { studentId: session.id },
    orderBy: { uploadedAt: "desc" },
  });

  return NextResponse.json({ files });
});

// POST — upload a file
export const POST = withAuth(async (session, req: Request) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const category = (formData.get("category") as string) || "general";

  if (!file) throw badRequest("No file provided");

  const validationError = validateFile({ size: file.size, type: file.type });
  if (validationError) throw badRequest(validationError);

  const buffer = Buffer.from(await file.arrayBuffer());
  const storageKey = generateStorageKey(session.id, file.name);

  try {
    await uploadFile(storageKey, buffer, file.type);
  } catch (err) {
    logger.error("File upload failed", { error: String(err) });
    throw new ApiError(500, "Failed to upload file to storage");
  }

  const record = await prisma.fileUpload.create({
    data: {
      studentId: session.id,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      storageKey,
      category,
    },
  });

  return NextResponse.json({ file: record });
});

// DELETE — delete a file
export const DELETE = withAuth(async (session, req: Request) => {
  const { id } = await parseBody(req, deleteFileSchema);

  const file = await prisma.fileUpload.findFirst({
    where: { id, studentId: session.id },
  });
  if (!file) throw notFound("File not found");

  // Delete the storage object FIRST and abort if it fails. Previously the DB
  // row was deleted unconditionally, so a storage failure orphaned the object
  // (a row pointing nowhere is worse than a recoverable retry). Ordering it
  // this way means a failure leaves both the row and the object intact so the
  // student can retry; the only residual risk is a dangling object if the DB
  // delete fails afterward, which is the safer direction (no broken reference).
  try {
    await deleteFile(file.storageKey);
  } catch (err) {
    logger.error("Failed to delete file from storage; aborting DB delete", {
      storageKey: file.storageKey,
      error: String(err),
    });
    throw new ApiError(500, "Failed to delete file. Please try again.");
  }
  await prisma.fileUpload.delete({ where: { id } });

  return NextResponse.json({ ok: true });
});
