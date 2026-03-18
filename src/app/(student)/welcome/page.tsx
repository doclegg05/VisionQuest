import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import WelcomeFlow from "./WelcomeFlow";

export default async function WelcomePage() {
  const session = await getSession();
  if (!session) redirect("/");

  // Check if student has any activity
  const [goalCount, conversationCount, progression] = await Promise.all([
    prisma.goal.count({ where: { studentId: session.id } }),
    prisma.conversation.count({ where: { studentId: session.id } }),
    prisma.progression.findUnique({ where: { studentId: session.id } }),
  ]);

  // If they have activity, they're not new — send to dashboard
  if (goalCount > 0 || conversationCount > 0 || progression) {
    redirect("/dashboard");
  }

  return <WelcomeFlow studentName={session.displayName} />;
}
