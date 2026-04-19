import Link from "next/link";
import { Compass, Sparkle } from "@phosphor-icons/react/dist/ssr";

import { prisma } from "@/lib/db";

interface CareerDnaCalloutProps {
  studentId: string;
}

export default async function CareerDnaCallout({ studentId }: CareerDnaCalloutProps) {
  const discovery = await prisma.careerDiscovery.findUnique({
    where: { studentId },
    select: { status: true, completedAt: true },
  });

  if (!discovery) return null;

  const isComplete = discovery.status === "complete";

  return (
    <aside className="rounded-2xl border border-[rgba(15,154,146,0.15)] bg-[rgba(15,154,146,0.08)] p-4">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent-green)] to-[#2a8a3c] text-white">
          {isComplete ? (
            <Sparkle size={22} weight="fill" />
          ) : (
            <Compass size={22} weight="duotone" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold text-[var(--ink-strong)]">
            Your Career DNA
          </h3>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {isComplete
              ? "Interests, strengths, values, and matching career clusters — revisit any time."
              : "Sage is still learning about you. Keep chatting and your DNA will fill in."}
          </p>
        </div>
        <Link
          href="/profile"
          prefetch={false}
          className="primary-button shrink-0 self-center px-4 py-2 text-sm"
        >
          {isComplete ? "Open" : "Preview"}
        </Link>
      </div>
    </aside>
  );
}
