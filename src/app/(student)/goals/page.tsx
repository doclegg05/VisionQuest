import Link from "next/link";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const LEVEL_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  bhag: { label: "Big Hairy Audacious Goal", icon: "⭐", color: "bg-amber-50 border-amber-300" },
  monthly: { label: "Monthly Goal", icon: "📅", color: "bg-blue-50 border-blue-300" },
  weekly: { label: "Weekly Goal", icon: "📆", color: "bg-green-50 border-green-300" },
  daily: { label: "Daily Goal", icon: "☀️", color: "bg-yellow-50 border-yellow-300" },
  task: { label: "Action Tasks", icon: "✅", color: "bg-purple-50 border-purple-300" },
};

const LEVEL_ORDER = ["bhag", "monthly", "weekly", "daily", "task"];

export default async function GoalsPage() {
  const session = await getSession();
  if (!session) return null;

  const goals = await prisma.goal.findMany({
    where: { studentId: session.id },
    orderBy: { createdAt: "asc" },
  });

  const goalsByLevel = new Map<string, typeof goals>();
  for (const goal of goals) {
    const list = goalsByLevel.get(goal.level) || [];
    list.push(goal);
    goalsByLevel.set(goal.level, list);
  }

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Goal map"
        title="My Goals"
        description="See how your vision connects to monthly, weekly, and daily action."
        actions={(
          <Link href="/chat" prefetch={false} className="primary-button px-5 py-3 text-sm">
            Talk to Sage
          </Link>
        )}
      />

      <div className="space-y-4">
        {LEVEL_ORDER.map((level) => {
          const config = LEVEL_CONFIG[level];
          const levelGoals = goalsByLevel.get(level) || [];

          return (
            <div
              key={level}
              className={`surface-section border-2 p-5 ${config.color} ${levelGoals.length === 0 ? "opacity-65" : ""}`}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xl">{config.icon}</span>
                <h2 className="font-display text-xl text-[var(--ink-strong)]">{config.label}</h2>
              </div>

              {levelGoals.length > 0 ? (
                <ul className="space-y-2">
                  {levelGoals.map((goal) => (
                    <li key={goal.id} className="rounded-2xl bg-white/70 px-4 py-3 text-[var(--ink-strong)]">
                      {goal.content}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm italic text-[var(--ink-muted)]">
                  Not set yet — talk to Sage to define this goal
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
