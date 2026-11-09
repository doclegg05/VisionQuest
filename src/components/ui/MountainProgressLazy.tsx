"use client";

import dynamic from "next/dynamic";
import { type ReadinessBreakdown } from "@/lib/progression/readiness-score";

const MountainProgress = dynamic(
  () => import("@/components/ui/MountainProgress"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[200px] animate-pulse rounded-3xl bg-gradient-to-b from-brand-royal to-brand-primary md:h-[320px]" />
    ),
  },
);

interface MountainProgressLazyProps {
  readinessScore: number;
  readinessBreakdown: ReadinessBreakdown;
  level: number;
}

export function MountainProgressLazy({ readinessScore, readinessBreakdown, level }: MountainProgressLazyProps) {
  return (
    <MountainProgress
      readinessScore={readinessScore}
      readinessBreakdown={readinessBreakdown}
      level={level}
    />
  );
}
