import { prismaAdmin } from "@/lib/db";
import { withRlsContext } from "@/lib/rls-context";
import { assembleStudentContextBundle } from "@/lib/sage/context-bundle";
import { resolveAiProvider } from "@/lib/ai/provider";
import { logger } from "@/lib/logger";

/**
 * Diagnose a LOST wager: read the student's context bundle, ask the model
 * why the proposal failed, and persist the answer as a dismissible
 * SageInsight (category "concern"). Gated by SAGE_WAGER_DIAGNOSIS_ENABLED.
 *
 * The model call routes through resolveAiProvider with sensitivity
 * "student_record" so the FERPA gate applies (local model in prod,
 * cloud in alpha).
 */
export async function diagnoseWager(wagerId: string): Promise<void> {
  if (process.env.SAGE_WAGER_DIAGNOSIS_ENABLED !== "true") return;

  const wager = await prismaAdmin.wager.findUnique({
    where: { id: wagerId },
    select: {
      id: true,
      studentId: true,
      hypothesis: true,
      verdict: { select: { id: true, result: true } },
    },
  });

  if (!wager || !wager.verdict || wager.verdict.result !== "loss") return;

  // Read the bundle under a seeded RLS context so the app-prisma queries
  // inside assembleStudentContextBundle resolve under the vq_app role.
  const bundle = withRlsContext(
    { userId: wager.studentId, role: "student", studentId: wager.studentId },
    () => assembleStudentContextBundle(wager.studentId, { viewer: "sage" }),
  );
  const resolvedBundle = await bundle;

  const provider = await resolveAiProvider({
    studentId: wager.studentId,
    task: "sage_post_response",
    sensitivity: "student_record",
  });

  const systemPrompt =
    "A goal proposal you made to this student was not confirmed within 14 days. " +
    "Given the student context below, diagnose in 1–2 sentences WHY it did not convert " +
    "and what you should do differently next time. Be concrete and non-judgmental.";

  const studentContextBlock =
    `Hypothesis: ${wager.hypothesis}\n\n` +
    `Student context: ${JSON.stringify(resolvedBundle).slice(0, 4000)}`;

  const diagnosis = (
    await provider.generateResponse(systemPrompt, [
      { role: "user", content: studentContextBlock },
    ])
  ).trim();

  if (!diagnosis) return;

  const insight = await prismaAdmin.sageInsight.create({
    data: {
      studentId: wager.studentId,
      category: "concern",
      content: diagnosis,
      confidence: null,
      status: "active",
    },
    select: { id: true },
  });

  await prismaAdmin.wagerVerdict.update({
    where: { id: wager.verdict.id },
    data: {
      diagnosis,
      diagnosisModel: provider.name,
      knowledgeUpdateId: insight.id,
    },
  });

  logger.info("Wager diagnosis recorded", {
    wagerId,
    insightId: insight.id,
    diagnosisModel: provider.name,
  });
}
