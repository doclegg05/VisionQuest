import { NextResponse } from "next/server";
import { syncStudentAlerts } from "@/lib/advising";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { isValidUrl } from "@/lib/validation";
import { getCertificationProgress } from "@/lib/certifications";
import { logAuditEvent } from "@/lib/audit";
import { recomputeCertificationStatus, recomputeCertificationStatusesForType } from "@/lib/certification-service";

// GET — list cert templates or all student cert progress
export const GET = withTeacherAuth(async (_session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view"); // "templates" or "students"

  if (view === "students") {
    // Get all certifications with student info
    const certs = await prisma.certification.findMany({
      include: {
        student: { select: { id: true, displayName: true, studentId: true } },
        requirements: true,
      },
    });

    const templates = await prisma.certTemplate.findMany({
      where: { certType: "ready-to-work" },
      select: {
        id: true,
        required: true,
        needsFile: true,
        needsVerify: true,
      },
    });

    const studentProgress = certs.map((cert) => {
      const { done, total } = getCertificationProgress(templates, cert.requirements);
      const pendingVerify = cert.requirements.filter((r) => r.completed && !r.verifiedBy).length;

      return {
        studentId: cert.student.id,
        displayName: cert.student.displayName,
        studentCode: cert.student.studentId,
        certId: cert.id,
        status: cert.status,
        done,
        total,
        pendingVerify,
      };
    });

    return NextResponse.json({ students: studentProgress });
  }

  // Default: list templates
  const templates = await prisma.certTemplate.findMany({
    where: { certType: "ready-to-work" },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ templates });
});

// POST — create a cert template
export const POST = withTeacherAuth(async (session, req: Request) => {
  const { label, description, url, required, needsFile, needsVerify } = await req.json();
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  if (url && !isValidUrl(url)) {
    return NextResponse.json({ error: "Invalid URL. Only http and https URLs are allowed." }, { status: 400 });
  }

  const maxOrder = await prisma.certTemplate.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  const template = await prisma.certTemplate.create({
    data: {
      label,
      description: description || null,
      url: url || null,
      required: required ?? true,
      needsFile: needsFile ?? false,
      needsVerify: needsVerify ?? true,
      sortOrder,
    },
  });

  const certifications = await prisma.certification.findMany({
    where: { certType: template.certType },
    select: { id: true },
  });

  if (certifications.length > 0) {
    await prisma.certRequirement.createMany({
      data: certifications.map((certification) => ({
        certificationId: certification.id,
        templateId: template.id,
      })),
      skipDuplicates: true,
    });
    await recomputeCertificationStatusesForType(template.certType);
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.cert_template.create",
    targetType: "cert_template",
    targetId: template.id,
    summary: `Created certification requirement template "${template.label}".`,
  });

  return NextResponse.json({ template });
});

// PUT — update a template or verify a student requirement
export const PUT = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json();

  // Verify a student's requirement
  if (body.requirementId) {
    const { requirementId, verified } = body;
    const requirement = await prisma.certRequirement.findUnique({
      where: { id: requirementId },
      include: {
        certification: true,
        template: {
          select: {
            id: true,
            label: true,
            certType: true,
            required: true,
            needsFile: true,
            needsVerify: true,
          },
        },
      },
    });
    if (!requirement) {
      return NextResponse.json({ error: "Requirement not found." }, { status: 404 });
    }
    if (!requirement.completed) {
      return NextResponse.json({ error: "Only completed requirements can be verified." }, { status: 400 });
    }
    await prisma.certRequirement.update({
      where: { id: requirementId },
      data: {
        verifiedBy: verified ? session.id : null,
        verifiedAt: verified ? new Date() : null,
      },
    });
    await recomputeCertificationStatus(requirement.certificationId, requirement.certification.certType);

    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: verified ? "teacher.cert.verify" : "teacher.cert.unverify",
      targetType: "cert_requirement",
      targetId: requirementId,
      summary: `${verified ? "Verified" : "Removed verification for"} ${requirement.template.label}.`,
      metadata: {
        certificationId: requirement.certificationId,
        studentId: requirement.certification.studentId,
        templateId: requirement.template.id,
      },
    });

    await syncStudentAlerts(requirement.certification.studentId);

    return NextResponse.json({ ok: true });
  }

  // Update a template
  const { id, label, description, url, required, needsFile, needsVerify, sortOrder } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (url !== undefined && url !== null && url !== "" && !isValidUrl(url)) {
    return NextResponse.json({ error: "Invalid URL. Only http and https URLs are allowed." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (label !== undefined) data.label = label;
  if (description !== undefined) data.description = description;
  if (url !== undefined) data.url = url;
  if (required !== undefined) data.required = required;
  if (needsFile !== undefined) data.needsFile = needsFile;
  if (needsVerify !== undefined) data.needsVerify = needsVerify;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;

  const template = await prisma.certTemplate.update({ where: { id }, data });
  await recomputeCertificationStatusesForType(template.certType);

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.cert_template.update",
    targetType: "cert_template",
    targetId: template.id,
    summary: `Updated certification requirement template "${template.label}".`,
  });

  return NextResponse.json({ template });
});

// DELETE — remove a cert template
export const DELETE = withTeacherAuth(async (session, req: Request) => {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const template = await prisma.certTemplate.findUnique({
    where: { id },
    select: { id: true, label: true, certType: true },
  });

  // Remove linked requirements first
  await prisma.certRequirement.deleteMany({ where: { templateId: id } });
  await prisma.certTemplate.delete({ where: { id } });
  if (template?.certType) {
    await recomputeCertificationStatusesForType(template.certType);
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.cert_template.delete",
    targetType: "cert_template",
    targetId: id,
    summary: template
      ? `Deleted certification requirement template "${template.label}".`
      : "Deleted a certification requirement template.",
  });

  return NextResponse.json({ ok: true });
});
