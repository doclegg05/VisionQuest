import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { downloadFile } from "@/lib/storage";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Students can download their own files; teachers can download any file
  const where = session.role === "teacher"
    ? { id }
    : { id, studentId: session.id };

  const file = await prisma.fileUpload.findFirst({ where });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const result = await downloadFile(file.storageKey);
  if (!result) return NextResponse.json({ error: "File not found in storage" }, { status: 404 });

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": result.mimeType,
      "Content-Disposition": `inline; filename="${file.filename}"`,
    },
  });
}
