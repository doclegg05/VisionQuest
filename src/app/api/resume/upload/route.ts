import { NextResponse } from "next/server";
import { withAuth, badRequest } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
import { resolveApiKey } from "@/lib/chat/api-key";
import { extractTextFromFile, extractResumeFromText } from "@/lib/resume-extract";
import { logger } from "@/lib/logger";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

export const POST = withAuth(async (session, req: Request) => {
  const rl = await rateLimit(`resume-upload:${session.id}`, 5, 10 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a few minutes." },
      { status: 429 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    throw badRequest("No file uploaded.");
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    throw badRequest("Only PDF and Word documents (.pdf, .docx) are supported.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw badRequest("File is too large. Maximum size is 5 MB.");
  }

  const apiKey = await resolveApiKey(session.id);

  const buffer = Buffer.from(await file.arrayBuffer());

  let rawText: string;
  try {
    rawText = await extractTextFromFile(buffer, file.type);
  } catch (err) {
    logger.error("Resume text extraction failed", { error: String(err) });
    throw badRequest("Could not read the document. Make sure it is a valid PDF or Word file.");
  }

  if (rawText.trim().length < 20) {
    throw badRequest(
      "The document appears to be empty or contains only images. Upload a text-based resume.",
    );
  }

  try {
    const result = await extractResumeFromText(apiKey, rawText, session.displayName);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("Resume AI extraction failed", { error: String(err) });
    return NextResponse.json(
      { error: "Sage could not parse the resume. Try a cleaner document or use the manual editor." },
      { status: 502 },
    );
  }
});
