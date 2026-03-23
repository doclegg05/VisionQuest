import { withAuth, badRequest, rateLimited } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { parseStoredResumeData, isResumeEmpty } from "@/lib/resume";
import { generateResumePdfArrayBuffer } from "@/lib/resume-pdf";
import { generateStorageKey, uploadFile } from "@/lib/storage";
import { logger } from "@/lib/logger";

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "resume";
}

export const POST = withAuth(async (session) => {
  const rl = await rateLimit(`resume-file:${session.id}`, 10, 10 * 60 * 1000);
  if (!rl.success) {
    throw rateLimited("Resume export is temporarily rate limited. Please wait a few minutes and try again.");
  }

  const stored = await prisma.resumeData.findUnique({
    where: { studentId: session.id },
    select: { data: true },
  });

  if (!stored) {
    throw badRequest("Save your resume in the Portfolio tab before attaching it to an application.");
  }

  const resume = parseStoredResumeData(stored.data);
  if (isResumeEmpty(resume)) {
    throw badRequest("Your saved resume is empty. Add content in the Portfolio tab before attaching it.");
  }

  const filename = `${sanitizeFileName(session.displayName)}_resume.pdf`;
  const storageKey = generateStorageKey(session.id, filename);

  try {
    const pdfBuffer = Buffer.from(await generateResumePdfArrayBuffer(session.displayName || "Resume", resume));
    await uploadFile(storageKey, pdfBuffer, "application/pdf");

    const file = await prisma.fileUpload.create({
      data: {
        studentId: session.id,
        filename,
        mimeType: "application/pdf",
        sizeBytes: pdfBuffer.byteLength,
        storageKey,
        category: "resume-generated",
      },
    });

    return Response.json({ file });
  } catch (error) {
    logger.error("Failed to generate application resume file", {
      studentId: session.id,
      error: String(error),
    });
    throw badRequest("Could not generate the resume PDF right now. Please try again.");
  }
});
