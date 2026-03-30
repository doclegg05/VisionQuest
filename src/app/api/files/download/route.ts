import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { downloadFile } from "@/lib/storage";
import { isStaffRole, withAuth } from "@/lib/api-error";

export const GET = withAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Students can download their own files; staff can download any file
  const where = isStaffRole(session.role)
    ? { id }
    : { id, studentId: session.id };

  const file = await prisma.fileUpload.findFirst({ where });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const result = await downloadFile(file.storageKey);
  if (!result) return NextResponse.json({ error: "File not found in storage" }, { status: 404 });

  // Sanitize filename for Content-Disposition header (RFC 6266)
  const safeFilename = file.filename
    .replace(/[^a-zA-Z0-9._\- ]/g, "_")
    .replace(/"+/g, "")
    .replace(/\.+$/, "")
    .slice(0, 200);

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": result.mimeType,
      "Content-Disposition": `inline; filename="${safeFilename}"`,
    },
  });
});
