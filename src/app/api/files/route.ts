import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateStorageKey, uploadFile, deleteFile, validateFile } from "@/lib/storage";

// GET — list student's files
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const files = await prisma.fileUpload.findMany({
    where: { studentId: session.id },
    orderBy: { uploadedAt: "desc" },
  });

  return NextResponse.json({ files });
}

// POST — upload a file
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const category = (formData.get("category") as string) || "general";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const validationError = validateFile({ size: file.size, type: file.type });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storageKey = generateStorageKey(session.id, file.name);

  try {
    await uploadFile(storageKey, buffer, file.type);
  } catch (err) {
    console.error("File upload failed:", err);
    return NextResponse.json({ error: "Failed to upload file to storage." }, { status: 500 });
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
}

// DELETE — delete a file
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const file = await prisma.fileUpload.findFirst({
    where: { id, studentId: session.id },
  });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  try {
    await deleteFile(file.storageKey);
  } catch (err) {
    console.warn("Failed to delete file from storage (orphaned file):", file.storageKey, err);
  }
  await prisma.fileUpload.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
