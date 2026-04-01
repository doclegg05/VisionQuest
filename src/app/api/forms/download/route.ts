import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { downloadFile } from "@/lib/storage";
import { canViewForm, FORMS, getFormById } from "@/lib/spokes/forms";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const formId = searchParams.get("formId");
  const fileName = searchParams.get("file");
  const mode = searchParams.get("mode") === "download" ? "download" : "view";

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

  if (!formId && !fileName) {
    return NextResponse.json({ error: "formId or file is required" }, { status: 400 });
  }

  if (!form) {
    return NextResponse.json(
      {
        error: "File not found",
        message: "This document is not registered in VisionQuest.",
      },
      { status: 404 },
    );
  }

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
