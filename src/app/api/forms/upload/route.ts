import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { uploadFile, generateStorageKey, validateFile } from "@/lib/storage";
import { FORMS } from "@/lib/spokes/forms";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const formId = formData.get("formId") as string | null;

    if (!file || !formId) {
      return NextResponse.json({ error: "File and formId are required." }, { status: 400 });
    }

    // Validate formId exists in FORMS
    const formDef = FORMS.find(f => f.id === formId);
    if (!formDef) {
      return NextResponse.json({ error: "Invalid form ID." }, { status: 400 });
    }

    // Validate file
    const validationError = validateFile({ size: file.size, type: file.type });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storageKey = generateStorageKey(session.id, file.name);

    // Upload to storage
    await uploadFile(storageKey, buffer, file.type);

    // Create FileUpload record
    const fileRecord = await prisma.fileUpload.create({
      data: {
        studentId: session.id,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        storageKey,
        category: "orientation",
      },
    });

    // Upsert FormSubmission (allows re-upload)
    const submission = await prisma.formSubmission.upsert({
      where: {
        studentId_formId: { studentId: session.id, formId },
      },
      create: {
        studentId: session.id,
        formId,
        fileId: fileRecord.id,
        status: "pending",
      },
      update: {
        fileId: fileRecord.id,
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        notes: null,
      },
    });

    return NextResponse.json({ submission, fileId: fileRecord.id });
  } catch (error) {
    logger.error("Form upload error", { error: String(error) });
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
