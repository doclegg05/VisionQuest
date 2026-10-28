import { NextRequest, NextResponse } from "next/server";
import { Writable } from "node:stream";
import archiver from "archiver";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { assertStaffCanManageClass, listManagedStudentIds } from "@/lib/classroom";
import { tryLogAuditEvent } from "@/lib/audit";
import { listCohortPacketStudents } from "@/lib/teacher/cohort-packets";
import { downloadFile } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

const classIdSchema = z.string().cuid();

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["teacher", "coordinator", "admin"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawClassId = searchParams.get("classId") || undefined;
  const parsedClassId = rawClassId === undefined ? null : classIdSchema.safeParse(rawClassId);
  if (parsedClassId && !parsedClassId.success) {
    return NextResponse.json({ error: "Invalid class id" }, { status: 400 });
  }
  const classId = parsedClassId?.data;

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

  const students = await listCohortPacketStudents(studentIds);

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
    let pdfBuffer: Buffer | null = null;

    if (student.storageKey) {
      const downloaded = await downloadFile(student.storageKey);
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
      const cleanLastName = (student.lastName || student.displayName.split(" ").slice(1).join(" ") || "Student").replace(/[^a-zA-Z0-9]/g, "_");
      const cleanFirstName = (student.firstName || student.displayName.split(" ")[0] || "Participant").replace(/[^a-zA-Z0-9]/g, "_");
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

  // One row per delivered export. Counts only: no student id or name goes in
  // the payload. A failed write is logged by tryLogAuditEvent and must not
  // withhold a download that is already built.
  const included = students.length - missing.length;
  await tryLogAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.class.packets_exported",
    targetType: "class",
    targetId: classId ?? null,
    summary: `Exported ${included} intake packet(s); ${missing.length} missing.`,
    metadata: { included, missing: missing.length },
  });

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
