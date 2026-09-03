import { NextRequest, NextResponse } from "next/server";
import { Writable } from "node:stream";
import archiver from "archiver";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertStaffCanManageClass, listManagedStudentIds } from "@/lib/classroom";
import { downloadFile } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["teacher", "coordinator", "admin"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("classId") || undefined;

  if (classId) {
    try {
      await assertStaffCanManageClass(session, classId);
    } catch {
      return NextResponse.json({ error: "Access denied for this class" }, { status: 403 });
    }
  }

  const studentIds = await listManagedStudentIds(session, {
    classId,
    includeInactiveAccounts: false,
  });

  if (studentIds.length === 0) {
    return NextResponse.json({ error: "No students found for this class scope" }, { status: 404 });
  }

  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    include: {
      spokesRecord: true,
      formSubmissions: {
        where: { formId: { in: ["orientation-intake", "student-intake"] } },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });

  // Collect file IDs from submissions
  const fileIds = students.map((s) => s.formSubmissions[0]?.fileId).filter(Boolean) as string[];
  const files = await prisma.fileUpload.findMany({
    where: { id: { in: fileIds } },
    select: { id: true, storageKey: true, filename: true },
  });
  const fileMap = new Map(files.map((f) => [f.id, f]));

  // Create ZIP in memory
  const chunks: Buffer[] = [];
  const bufferStream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(bufferStream);

  // Students whose packet could not be exported, reported in the archive rather
  // than silently omitted — a cohort export that is quietly short a packet reads
  // as "this student has none", which is a different claim from "we could not
  // retrieve it".
  const missing: string[] = [];

  for (const student of students) {
    const sub = student.formSubmissions[0];
    const file = sub ? fileMap.get(sub.fileId) : null;
    let pdfBuffer: Buffer | null = null;

    if (file) {
      const downloaded = await downloadFile(file.storageKey);
      if (downloaded) {
        pdfBuffer = downloaded.buffer;
      } else {
        logger.warn("Archived intake packet missing from storage during cohort export", {
          alert: "packet_missing_from_storage",
          student: studentLogKey(student.id),
          surface: "export-packets",
        });
      }
    }

    // A packet is EXPORTED, never regenerated. The signature evidence — who
    // signed, when, from where, and the drawn image — exists only inside the
    // archived bytes, so re-rendering one would replace a participant's signed
    // state form with a lookalike built from defaults, in bulk, for a whole
    // cohort. That is the same fabrication the single-student approval path was
    // just stripped of (review B4b); it does not become acceptable at scale.
    // A student with no archived packet is reported as missing.
    if (pdfBuffer) {
      const cleanLastName = (student.spokesRecord?.lastName || student.displayName.split(" ").slice(1).join(" ") || "Student").replace(/[^a-zA-Z0-9]/g, "_");
      const cleanFirstName = (student.spokesRecord?.firstName || student.displayName.split(" ")[0] || "Participant").replace(/[^a-zA-Z0-9]/g, "_");
      const filename = `${cleanLastName}_${cleanFirstName}_SPOKES_Intake.pdf`;
      archive.append(pdfBuffer, { name: filename });
    } else {
      missing.push(`${student.displayName} (${student.studentId})`);
    }
  }

  if (missing.length > 0) {
    archive.append(
      [
        "SPOKES cohort intake export — packets not included",
        "",
        "These participants have no signed intake packet on file, so nothing was",
        "exported for them. This export never generates a replacement: a packet",
        "carries the participant's own signature and consent, and a regenerated",
        "one would assert both without either having happened.",
        "",
        "To obtain a packet, have the participant complete and sign their intake.",
        "",
        ...missing.map((entry) => `  - ${entry}`),
        "",
        `${missing.length} of ${students.length} participants in this export.`,
      ].join("\n"),
      { name: "MISSING_PACKETS.txt" },
    );
  }

  await archive.finalize();

  const zipBuffer = Buffer.concat(chunks);
  const classSuffix = classId ? `_${classId.slice(-6)}` : "";
  const zipFilename = `SPOKES_Cohort_Intake_Packets${classSuffix}.zip`;

  return new Response(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}"`,
      "Content-Length": zipBuffer.length.toString(),
    },
  });
}
