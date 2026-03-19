import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { downloadFile } from "@/lib/storage";

/**
 * GET /api/forms/download?file=<fileName>&name=<displayName>
 *
 * Downloads a program-level form PDF from Supabase Storage.
 * The file must exist in the "forms/" folder of the storage bucket.
 * Any authenticated user (student or teacher) can download program forms.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fileName = searchParams.get("file");
  const displayName = searchParams.get("name") ?? fileName ?? "document";

  if (!fileName) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  // Sanitize: prevent path traversal attacks
  const safeName = fileName.replace(/\.\./g, "").replace(/[/\\]/g, "");
  if (!safeName) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  // Program forms live in the "forms/" folder in Supabase Storage
  const storageKey = `forms/${safeName}`;
  const result = await downloadFile(storageKey);

  if (!result) {
    return NextResponse.json(
      {
        error: "File not found",
        message:
          "This document has not been uploaded yet. Ask your instructor to upload the file.",
      },
      { status: 404 }
    );
  }

  const safeDisplayName = displayName.replace(/[^a-zA-Z0-9._\- ]/g, "_");

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": result.mimeType || "application/pdf",
      "Content-Disposition": `attachment; filename="${safeDisplayName}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
