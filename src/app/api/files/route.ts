import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateStorageKey, uploadFile, deleteFile, validateFile } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { ApiError, withErrorHandler, unauthorized, badRequest, notFound } from "@/lib/api-error";

// GET — list student's files
export const GET = withErrorHandler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const files = await prisma.fileUpload.findMany({
    where: { studentId: session.id },
    orderBy: { uploadedAt: "desc" },
  });

  return NextResponse.json({ files });
});

// POST — upload a file
export const POST = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session) throw unauthorized();

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
export const DELETE = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const { id } = await req.json();
  if (!id) throw badRequest("id is required");

  const file = await prisma.fileUpload.findFirst({
    where: { id, studentId: session.id },
  });
  if (!file) throw notFound("File not found");

  try {
    await deleteFile(file.storageKey);
  } catch (err) {
    logger.warn("Failed to delete file from storage (orphaned file)", { storageKey: file.storageKey, error: String(err) });
  }
  await prisma.fileUpload.delete({ where: { id } });

  return NextResponse.json({ ok: true });
});
