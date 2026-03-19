import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  hasConfiguredSecurityQuestionSet,
  SECURITY_QUESTIONS,
  validateSecurityQuestionAnswers,
} from "@/lib/security-questions";
import { hashSecurityAnswers } from "@/lib/security-question-auth";
import { logAuditEvent } from "@/lib/audit";
import { withAuth } from "@/lib/api-error";

export const GET = withAuth(async (session) => {
  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: {
      securityQuestionAnswers: {
        orderBy: { questionKey: "asc" },
        select: { questionKey: true },
      },
    },
  });

  const configured = hasConfiguredSecurityQuestionSet(
    student?.securityQuestionAnswers.map((item) => item.questionKey) ?? []
  );

  return Response.json({
    configured,
    questions: SECURITY_QUESTIONS,
  });
});

export const POST = withAuth(async (session, req: NextRequest) => {
  const rl = await rateLimit(`security-questions:${session.id}`, 5, 15 * 60 * 1000);
  if (!rl.success) {
    return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await req.json();
  const securityQuestionsResult = validateSecurityQuestionAnswers(body.securityQuestions);

  if (securityQuestionsResult.error) {
    return Response.json({ error: securityQuestionsResult.error }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.securityQuestionAnswer.deleteMany({
      where: { studentId: session.id },
    });

    await tx.securityQuestionAnswer.createMany({
      data: hashSecurityAnswers(securityQuestionsResult.answers).map((item) => ({
        studentId: session.id,
        questionKey: item.questionKey,
        answerHash: item.answerHash,
      })),
    });
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "settings.security_questions_saved",
    targetType: "student",
    targetId: session.id,
    summary: "Student saved classroom recovery questions.",
  });

  return Response.json({ success: true });
});
