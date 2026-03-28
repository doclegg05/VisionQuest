import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { uploadFile, generateStorageKey } from "@/lib/storage";
import { FORMS } from "@/lib/spokes/forms";
import { logger } from "@/lib/logger";
import { withAuth, badRequest } from "@/lib/api-error";
import { syncStudentAlerts } from "@/lib/advising";

/**
 * POST /api/forms/sign
 * Submit a digital signature for a form that requires one.
 * Accepts JSON with { formId, signature } where signature is a base64 PNG data URL.
 * Optionally accepts { formId, signature, fileId } when a file was already uploaded.
 */
export const POST = withAuth(async (session, req: NextRequest) => {
  try {
    const body = await req.json();
    const { formId, signature, fileId } = body as {
      formId?: string;
      signature?: string;
      fileId?: string;
    };

    if (!formId || !signature) {
      throw badRequest("formId and signature are required.");
    }

    // Validate formId
    const formDef = FORMS.find((f) => f.id === formId);
    if (!formDef) {
      throw badRequest("Invalid form ID.");
    }
    if (!formDef.requiresSignature) {
      throw badRequest("This form does not require a signature.");
    }

    // Validate signature is a base64 PNG data URL
    if (!signature.startsWith("data:image/png;base64,")) {
      throw badRequest("Signature must be a PNG data URL.");
    }

    // Decode and upload signature image
    const base64Data = signature.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length > 500_000) {
      throw badRequest("Signature image too large.");
    }

    const storageKey = generateStorageKey(session.id, `signature-${formId}.png`);
    await uploadFile(storageKey, buffer, "image/png");

    // Create FileUpload record for the signature
    const sigFile = await prisma.fileUpload.create({
      data: {
        studentId: session.id,
        filename: `signature-${formId}.png`,
        mimeType: "image/png",
        sizeBytes: buffer.length,
        storageKey,
        category: "signature",
      },
    });

    // If no file was uploaded yet, create a placeholder fileId
    // (for non-fillable forms where the student just reads and signs)
    const resolvedFileId = fileId || sigFile.id;

    // Upsert FormSubmission with signature
    const submission = await prisma.formSubmission.upsert({
      where: {
        studentId_formId: { studentId: session.id, formId },
      },
      create: {
        studentId: session.id,
        formId,
        fileId: resolvedFileId,
        signatureFileId: sigFile.id,
        status: "pending",
      },
      update: {
        signatureFileId: sigFile.id,
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        notes: null,
        // Preserve existing fileId if one was already uploaded
        ...(fileId ? { fileId } : {}),
      },
    });

    await syncStudentAlerts(session.id);

    return NextResponse.json({
      submission,
      signatureFileId: sigFile.id,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    logger.error("Signature submission error", { error: String(error) });
    return NextResponse.json({ error: "Signature submission failed." }, { status: 500 });
  }
});
