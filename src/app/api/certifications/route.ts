import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCertificationProgress, validateRequirementUpdate } from "@/lib/certifications";
import { recomputeCertificationStatus } from "@/lib/certification-service";

// GET — get student's certification with requirements
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get all templates
  const templates = await prisma.certTemplate.findMany({
    where: { certType: "ready-to-work" },
    orderBy: { sortOrder: "asc" },
  });

  // Get or create certification record
  let cert = await prisma.certification.findUnique({
    where: { studentId_certType: { studentId: session.id, certType: "ready-to-work" } },
    include: { requirements: true },
  });

  if (!cert && templates.length > 0) {
    // Auto-create certification and requirement records from templates
    cert = await prisma.certification.create({
      data: {
        studentId: session.id,
        certType: "ready-to-work",
        requirements: {
          create: templates.map((t) => ({
            templateId: t.id,
          })),
        },
      },
      include: { requirements: true },
    });
  }

  if (!cert) {
    return NextResponse.json({ certification: null, templates: [], requirements: [] });
  }

  cert = await recomputeCertificationStatus(cert.id, cert.certType);

  // Merge template info with requirement progress
  const requirements = templates.map((t) => {
    const req = cert!.requirements.find((r) => r.templateId === t.id);
    return {
      id: req?.id || null,
      templateId: t.id,
      label: t.label,
      description: t.description,
      url: t.url,
      required: t.required,
      needsFile: t.needsFile,
      needsVerify: t.needsVerify,
      completed: req?.completed || false,
      completedAt: req?.completedAt || null,
      verifiedBy: req?.verifiedBy || null,
      verifiedAt: req?.verifiedAt || null,
      fileId: req?.fileId || null,
      notes: req?.notes || null,
    };
  });

  const { total, done } = getCertificationProgress(templates, requirements);

  return NextResponse.json({
    certification: {
      id: cert.id,
      status: cert.status,
      startedAt: cert.startedAt,
      completedAt: cert.completedAt,
    },
    requirements,
    total,
    done,
  });
}

// POST — mark a requirement as completed (self-report)
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { requirementId, completed, fileId, notes } = await req.json();
  if (!requirementId) {
    return NextResponse.json({ error: "requirementId is required" }, { status: 400 });
  }

  // Verify the requirement belongs to this student's certification
  const requirement = await prisma.certRequirement.findFirst({
    where: { id: requirementId },
    include: {
      certification: true,
      template: {
        select: {
          id: true,
          certType: true,
          required: true,
          needsFile: true,
          needsVerify: true,
        },
      },
    },
  });

  if (!requirement || requirement.certification.studentId !== session.id) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  if (fileId !== undefined && fileId !== null) {
    const file = await prisma.fileUpload.findFirst({
      where: { id: fileId, studentId: session.id },
      select: { id: true },
    });

    if (!file) {
      return NextResponse.json({ error: "Attached file was not found." }, { status: 400 });
    }
  }

  const nextState = {
    templateId: requirement.templateId,
    completed: typeof completed === "boolean" ? completed : requirement.completed,
    verifiedBy: typeof completed === "boolean" && !completed ? null : requirement.verifiedBy,
    fileId: fileId !== undefined ? (fileId || null) : requirement.fileId,
  };
  if (typeof completed === "boolean" || fileId !== undefined) {
    const validationError = validateRequirementUpdate(requirement.template, nextState);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
  }

  const data: Record<string, unknown> = {};
  if (typeof completed === "boolean") {
    data.completed = completed;
    data.completedAt = completed ? new Date() : null;
    if (!completed) {
      data.verifiedBy = null;
      data.verifiedAt = null;
    }
  }
  if (fileId !== undefined) data.fileId = fileId || null;
  if (notes !== undefined) data.notes = notes;

  await prisma.certRequirement.update({
    where: { id: requirementId },
    data,
  });

  // Check if all required requirements are truly satisfied.
  await recomputeCertificationStatus(requirement.certificationId, requirement.template.certType);

  return NextResponse.json({ ok: true });
}
