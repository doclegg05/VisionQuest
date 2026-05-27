import { NextResponse } from "next/server";
import { withAuth, badRequest, rateLimited } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { resolveAiProvider, type AIProvider } from "@/lib/ai";
import { getProviderClass, logAiAuditEvent, policyDecisionForProvider } from "@/lib/ai/audit";
import { logger } from "@/lib/logger";
import {
  parseStoredResumeData,
  resumeAssistRequestSchema,
  type ResumeCertification,
} from "@/lib/resume";
import { generateResumeDraft } from "@/lib/resume-ai";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";

const CERTIFICATION_NAME_BY_ID = new Map(CERTIFICATIONS.map((item) => [item.id, item.name]));

export const POST = withAuth(async (session, req: Request) => {
  const rl = await rateLimit(`resume-assist:${session.id}`, 8, 10 * 60 * 1000);
  if (!rl.success) {
    throw rateLimited("Resume drafting is temporarily rate limited. Please wait a few minutes and try again.");
  }

  const body = await parseBody(req, resumeAssistRequestSchema);
  let provider: AIProvider;
  try {
    provider = await resolveAiProvider({
      studentId: session.id,
      task: "resume_assist",
      sensitivity: "student_record",
    });
  } catch (error) {
    await logAiAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      route: "/api/resume/assist",
      task: "resume_assist",
      sensitivity: "student_record",
      policyDecision: "blocked",
      status: "blocked",
      targetId: session.id,
      providerName: null,
      providerClass: "none",
      allowCloud: false,
      inputChars: body.prompt.length,
      reason: error instanceof Error ? error.message : String(error),
      errorCode: "LOCAL_AI_UNAVAILABLE",
    });
    return NextResponse.json(
      { error: "Sage resume drafting is offline until the local AI server is available." },
      { status: 503 },
    );
  }
  const providerClass = getProviderClass(provider.name);
  const assistPolicyDecision = policyDecisionForProvider(provider.name);
  const assistAllowCloud = providerClass === "cloud";
  await logAiAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    route: "/api/resume/assist",
    task: "resume_assist",
    sensitivity: "student_record",
    policyDecision: assistPolicyDecision,
    status: "routed",
    targetId: session.id,
    providerName: provider.name,
    providerClass,
    allowCloud: assistAllowCloud,
    inputChars: body.prompt.length,
    reason:
      assistPolicyDecision === "local_only"
        ? "Resume drafting uses student records and is local-only by policy."
        : "Operator configured cloud AI; resume drafting routed to the configured provider.",
  });

  const [student, goals, portfolioItems, certifications, storedResume] = await Promise.all([
    prisma.student.findUnique({
      where: { id: session.id },
      select: {
        displayName: true,
        email: true,
      },
    }),
    prisma.goal.findMany({
      where: { studentId: session.id, status: { in: ["active", "completed"] } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { content: true },
    }),
    prisma.portfolioItem.findMany({
      where: { studentId: session.id },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        title: true,
        description: true,
        type: true,
      },
    }),
    prisma.certification.findMany({
      where: {
        studentId: session.id,
        status: "completed",
      },
      orderBy: { completedAt: "desc" },
      take: 8,
      select: {
        certType: true,
        completedAt: true,
      },
    }),
    prisma.resumeData.findUnique({
      where: { studentId: session.id },
      select: { data: true },
    }),
  ]);

  const certificationEntries: ResumeCertification[] = certifications.map((item) => ({
    name: CERTIFICATION_NAME_BY_ID.get(item.certType) || item.certType,
    issuer: "SPOKES Program",
    dates: item.completedAt ? item.completedAt.toLocaleDateString("en-US", { year: "numeric", month: "short" }) : "",
  }));

  try {
    const result = await generateResumeDraft(provider, {
      studentName: student?.displayName || session.displayName,
      studentEmail: student?.email || "",
      prompt: body.prompt,
      existingResume: parseStoredResumeData(storedResume?.data),
      goals: goals.map((goal) => goal.content),
      portfolioItems,
      certifications: certificationEntries,
    });

    await logAiAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      route: "/api/resume/assist",
      task: "resume_assist",
      sensitivity: "student_record",
      policyDecision: assistPolicyDecision,
      status: "completed",
      targetId: session.id,
      providerName: provider.name,
      providerClass,
      allowCloud: assistAllowCloud,
      inputChars: body.prompt.length,
      outputChars: JSON.stringify(result).length,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("Resume assist failed", {
      studentId: session.id,
      error: String(error),
    });
    await logAiAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      route: "/api/resume/assist",
      task: "resume_assist",
      sensitivity: "student_record",
      policyDecision: assistPolicyDecision,
      status: "failed",
      targetId: session.id,
      providerName: provider.name,
      providerClass,
      allowCloud: assistAllowCloud,
      inputChars: body.prompt.length,
      reason: error instanceof Error ? error.message : String(error),
      errorCode: "RESUME_ASSIST_FAILED",
    });
    throw badRequest("Sage could not draft the resume right now. Please try again.");
  }
});
