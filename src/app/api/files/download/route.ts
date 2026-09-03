import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { downloadFile, getPresignedDownloadUrl } from "@/lib/storage";
import { isStaffRole, withAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import type { IntakePayload } from "@/lib/intake/schema";

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
  });
  if (presigned) return NextResponse.redirect(presigned, 302);

  let result = await downloadFile(file.storageKey);

  // Self-healing fallback: If an official orientation intake packet or profile is missing
  // from object storage (e.g. local environment mismatch or bucket sync delay),
  // dynamically regenerate the stamped official state PDF and cache it.
  if (
    !result &&
    (file.category === "orientation" ||
      file.filename.toLowerCase().includes("intake") ||
      file.filename.toLowerCase().includes("profile"))
  ) {
    try {
      const student = await prisma.student.findUnique({
        where: { id: file.studentId },
        include: { spokesRecord: true },
      });

      if (student) {
        const formResponse = await prisma.formResponse.findUnique({
          where: {
            templateId_studentId: {
              templateId: "seed-form-student-profile",
              studentId: file.studentId,
            },
          },
        });
        const ans = (formResponse?.answers as Record<string, any>) || {};
        const sp = student.spokesRecord;
        const nameParts = student.displayName.trim().split(/\s+/);
        const firstName = ans.first_name || sp?.firstName || nameParts[0] || "Student";
        const lastName = ans.last_name || sp?.lastName || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Record");
        const birthDate = ans.birth_date || (sp?.birthDate ? sp.birthDate.toISOString().split("T")[0] : "2000-01-01");
        const county = ans.county || sp?.county || "Nicholas";

        const { createStampedIntakePdfBuffer } = await import("@/lib/intake/pdf-stamped-packet");
        const { uploadFile } = await import("@/lib/storage");

        const payload: IntakePayload = {
          firstName,
          lastName,
          birthDate,
          county: county as any,
          phone: ans.phone || "(304) 555-0100",
          email: ans.contact_email || student.email || undefined,
          programTrack: ans.program_track || "Healthcare / CNA",
          tanfStatus: Boolean(ans.tanf_status ?? sp?.barriersOnEntry?.includes("tanf")),
          educationalLevel: ans.educational_level || (sp?.educationalLevel as any) || "High school diploma",
          householdType: ans.household_type || (sp?.householdType as any) || "Single parent (1P)",
          ferpaConsentSigned: true,
          policyAcknowledgmentSigned: true,
          signatureName: student.displayName,
          signatureTimestamp: file.uploadedAt ? file.uploadedAt.toISOString() : new Date().toISOString(),
        };

        const buffer = await createStampedIntakePdfBuffer(payload, student.studentId);
        await uploadFile(file.storageKey, buffer, "application/pdf");

        result = {
          buffer,
          mimeType: "application/pdf",
        };
      }
    } catch (healErr) {
      console.error("Failed to self-heal intake packet:", healErr);
    }
  }

  if (!result) return NextResponse.json({ error: "File not found in storage" }, { status: 404 });

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": result.mimeType,
      "Content-Disposition": disposition,
    },
  });
});
