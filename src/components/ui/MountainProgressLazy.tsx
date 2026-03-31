"use client";

import dynamic from "next/dynamic";
import { type ReadinessBreakdown } from "@/lib/progression/readiness-score";

const MountainProgress = dynamic(
  () => import("@/components/ui/MountainProgress"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[200px] animate-pulse rounded-[1.5rem] bg-gradient-to-b from-[#1a2a4a] to-[#4a7cb8] md:h-[320px]" />
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
