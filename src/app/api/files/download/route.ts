import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { downloadFile, getPresignedDownloadUrl } from "@/lib/storage";
import { isStaffRole, withAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import { detectedFileType, safeDownloadType } from "@/lib/file-security";

export const GET = withAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Students can only download their own files
  const where = isStaffRole(session.role)
    ? { id }
    : { id, studentId: session.id };

  const file = await prisma.fileUpload.findFirst({ where });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  // Teachers can only download files belonging to students they manage;
  // admins can download any file
  if (session.role === "teacher") {
    await assertStaffCanManageStudent(session, file.studentId);
  }

  // Sanitize filename for Content-Disposition header (RFC 6266)
  const safeFilename = file.filename
    .replace(/[^a-zA-Z0-9._\- ]/g, "_")
    .replace(/"+/g, "")
    .replace(/\.+$/, "")
    .slice(0, 200);
  const disposition = `inline; filename="${safeFilename}"`;

  const presigned = await getPresignedDownloadUrl(file.storageKey, {
    contentDisposition: disposition,
    contentType: safeDownloadType(file.mimeType),
  });
  if (presigned) return NextResponse.redirect(presigned, 302);

  const result = await downloadFile(file.storageKey);

  // A missing object is a 404 and nothing else.
  //
  // This branch used to "self-heal": when an orientation packet was absent from
  // storage it rebuilt one from whatever demographics it could scrape together,
  // filling the gaps with invented constants, hardcoding ferpaConsentSigned and
  // policyAcknowledgmentSigned to true, stamping the student's name and a
  // timestamp into the signature block, and writing the result over the
  // canonical storage key. The output was a signed FERPA consent for a
  // state-audited TANF program that no student had ever signed, and after the
  // write nothing distinguished it from a genuine one. It also made a GET
  // mutate storage, so any authorized reader — including an auditor opening the
  // packet — triggered the forgery.
  //
  // A record that points at a missing object is a storage incident to
  // investigate, not a document to reconstruct. Report it and say so.
  if (!result) {
    logger.warn("File record has no object in storage", {
      fileId: file.id,
      category: file.category,
      student: studentLogKey(file.studentId),
    });
    return NextResponse.json({ error: "File not found in storage" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": detectedFileType(result.buffer) || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Disposition": disposition,
    },
  });
});
