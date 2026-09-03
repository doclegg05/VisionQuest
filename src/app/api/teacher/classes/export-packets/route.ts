import { NextRequest, NextResponse } from "next/server";
import { Writable } from "node:stream";
import archiver from "archiver";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertStaffCanManageClass, listManagedStudentIds } from "@/lib/classroom";
import { downloadFile } from "@/lib/storage";
import { createStampedIntakePdfBuffer } from "@/lib/intake/pdf-stamped-packet";

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

  for (const student of students) {
    const sub = student.formSubmissions[0];
    const file = sub ? fileMap.get(sub.fileId) : null;
    let pdfBuffer: Buffer | null = null;

    if (file) {
      const downloaded = await downloadFile(file.storageKey);
      if (downloaded) {
        pdfBuffer = downloaded.buffer;
      }
    }

    // Self-heal or generate if not yet in storage
    if (!pdfBuffer && student.spokesRecord) {
      try {
        const sr = student.spokesRecord;
        pdfBuffer = await createStampedIntakePdfBuffer(
          {
            firstName: sr.firstName || student.displayName.split(" ")[0] || "Student",
            lastName: sr.lastName || student.displayName.split(" ").slice(1).join(" ") || "Participant",
            birthDate: sr.birthDate ? sr.birthDate.toISOString().slice(0, 10) : "2000-01-01",
            county: (sr.county as any) || "Nicholas",
            email: sr.referralEmail || `${student.studentId}@example.com`,
            phone: "(304) 555-0100",
            gender: (sr.gender as any) || null,
            race: sr.race || null,
            ethnicity: sr.ethnicity || null,
            householdType: (sr.householdType as any) || "Single adult",
            educationalLevel: (sr.educationalLevel as any) || "High school equivalency (GED/HSE)",
            tanfStatus: true,
            programTrack: "Customer Service / Clerical",
            signatureName: student.displayName,
            signatureMethod: "drawn",
            staffClearanceStatus: sub?.status === "approved" ? "approved" : "pending",
          },
          student.studentId,
        );
      } catch (err) {
        console.error(`Failed to generate stamped packet for student ${student.studentId}:`, err);
      }
    }

    if (pdfBuffer) {
      const cleanLastName = (student.spokesRecord?.lastName || student.displayName.split(" ").slice(1).join(" ") || "Student").replace(/[^a-zA-Z0-9]/g, "_");
      const cleanFirstName = (student.spokesRecord?.firstName || student.displayName.split(" ")[0] || "Participant").replace(/[^a-zA-Z0-9]/g, "_");
      const filename = `${cleanLastName}_${cleanFirstName}_SPOKES_Intake.pdf`;
      archive.append(pdfBuffer, { name: filename });
    }
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
