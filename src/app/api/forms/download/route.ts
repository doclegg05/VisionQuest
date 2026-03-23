import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { downloadFile } from "@/lib/storage";
import { canViewForm, FORMS, getFormById } from "@/lib/spokes/forms";

/**
 * GET /api/forms/download?formId=<formId>&mode=view|download
 * GET /api/forms/download?file=<fileName>&name=<displayName>
 *
 * Downloads a program-level form PDF from Supabase Storage.
 * `formId` is the preferred contract because forms now resolve to explicit
 * storage keys instead of assuming every file lives under "forms/".
 * Any authenticated user (student or teacher) can download program forms.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const formId = searchParams.get("formId");
  const fileName = searchParams.get("file");
  const mode = searchParams.get("mode") === "download" ? "download" : "view";
  const displayName = searchParams.get("name") ?? fileName ?? "document";

  let form = formId ? getFormById(formId) : undefined;
  if (!form && fileName) {
    const safeName = fileName.replace(/\.\./g, "").replace(/[/\\]/g, "");
    if (!safeName) {
      return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
    }

    form = FORMS.find(
      (candidate) =>
        candidate.fileName === fileName
        || candidate.storageKey?.split("/").pop() === safeName,
    );
  }

  if (form) {
    if (!canViewForm(form, session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!form.storageKey) {
      return NextResponse.json(
        {
          error: "File not found",
          message:
            "This form is not connected to a digital PDF yet. Your instructor can still collect a paper copy.",
        },
        { status: 404 },
      );
    }

    const result = await downloadFile(form.storageKey);
    if (!result) {
      return NextResponse.json(
        {
          error: "File not found",
          message:
            "This document has not been uploaded yet. Ask your instructor to upload the file.",
        },
        { status: 404 },
      );
    }

    const safeDisplayName = (form.fileName || form.title)
      .replace(/[^a-zA-Z0-9._\- ]/g, "_")
      .slice(0, 200);
    const disposition = mode === "download"
      ? `attachment; filename="${safeDisplayName}"`
      : `inline; filename="${safeDisplayName}"`;

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": result.mimeType || "application/pdf",
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  if (!fileName) {
    return NextResponse.json({ error: "formId or file is required" }, { status: 400 });
  }

  const safeName = fileName.replace(/\.\./g, "").replace(/[/\\]/g, "");
  if (!safeName) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  const fallbackKeys = [
    `forms/${safeName}`,
    `orientation/${safeName}`,
    `students/resources/${safeName}`,
  ];

  let result = null;
  for (const storageKey of fallbackKeys) {
    result = await downloadFile(storageKey);
    if (result) break;
  }

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
  const disposition = mode === "download"
    ? `attachment; filename="${safeDisplayName}"`
    : `inline; filename="${safeDisplayName}"`;

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": result.mimeType || "application/pdf",
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
