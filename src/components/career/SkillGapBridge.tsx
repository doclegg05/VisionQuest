"use client";

import Link from "next/link";
import type { SkillGapAnalysis, SkillGapItem } from "@/lib/sage/skill-gap";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SkillGapBridgeProps {
  analysis: SkillGapAnalysis | null;
}

// ─── Importance Badge ─────────────────────────────────────────────────────────

const IMPORTANCE_STYLES: Record<SkillGapItem["importance"], { dot: string; label: string }> = {
  essential: { dot: "bg-red-500", label: "essential" },
  important:  { dot: "bg-amber-400", label: "important" },
  helpful:    { dot: "bg-[var(--surface-muted)]", label: "helpful" },
};

function ImportanceBadge({ importance }: { importance: SkillGapItem["importance"] }) {
  const style = IMPORTANCE_STYLES[importance];
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${style.dot}`} />
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
        {style.label}
      </span>
    </span>
  );
}

// ─── Skill Card ───────────────────────────────────────────────────────────────

function SkillCard({ skill }: { skill: SkillGapItem }) {
  return (
    <div className="rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)]/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug text-[var(--ink-strong)]">
          {skill.name}
        </p>
        <ImportanceBadge importance={skill.importance} />
      </div>

      {skill.status === "have" && skill.evidence && (
        <p className="mt-1.5 text-xs italic text-[var(--ink-muted)]">
          &ldquo;{skill.evidence}&rdquo;
        </p>
      )}

      {skill.status === "building" && skill.buildingVia && (
        <p className="mt-1.5 text-xs text-[var(--ink-muted)]">
          Via{" "}
          <span className="font-medium text-[var(--ink-strong)]">{skill.buildingVia}</span>
        </p>
      )}

      {skill.status === "need" && skill.recommendedAction && (
        <p className="mt-1.5 text-xs text-[var(--ink-muted)]">
          <span className="font-medium text-[var(--primary)]">Next step:</span>{" "}
          {skill.recommendedAction}
        </p>
      )}
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

interface ColumnProps {
  title: string;
  count: number;
  skills: SkillGapItem[];
  headerClass: string;
  emptyText: string;
}

function Column({ title, count, skills, headerClass, emptyText }: ColumnProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className={`rounded-[1rem] px-3 py-2 ${headerClass}`}>
        <p className="text-xs font-bold uppercase tracking-[0.14em]">{title}</p>
        <p className="text-2xl font-bold leading-none">{count}</p>
      </div>

      {skills.length === 0 ? (
        <p className="text-xs text-[var(--ink-muted)] px-1">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <SkillCard key={skill.name} skill={skill} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Readiness Progress Bar ───────────────────────────────────────────────────

function ReadinessBar({
  haveCount,
  buildingCount,
  needCount,
  total,
  readinessPercent,
}: {
  haveCount: number;
  buildingCount: number;
  needCount: number;
  total: number;
  readinessPercent: number;
}) {
  const havePct = total > 0 ? (haveCount / total) * 100 : 0;
  const buildingPct = total > 0 ? (buildingCount / total) * 100 : 0;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--ink-muted)]">
          Career Readiness
        </span>
        <span className="text-sm font-bold text-[var(--ink-strong)]">
          {readinessPercent}%
        </span>
      </div>

      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${havePct}%` }}
          title={`Have: ${haveCount}`}
        />
        <div
          className="h-full bg-amber-400 transition-all"
          style={{ width: `${buildingPct}%` }}
          title={`Building: ${buildingCount}`}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-muted)]">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-emerald-500" />
          Have ({haveCount})
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-amber-400" />
          Building ({buildingCount})
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-[var(--surface-muted)]" />
          Need ({needCount})
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SkillGapBridge({ analysis }: SkillGapBridgeProps) {
  if (!analysis) {
    return (
      <div className="surface-section p-6 text-center">
        <p className="text-sm font-semibold text-[var(--ink-strong)]">
          Skill Gap Analysis not available yet
        </p>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">
          Complete your career discovery with Sage to see your skill analysis.
        </p>
        <Link
          href="/chat"
          prefetch={false}
          className="primary-button mt-5 inline-flex px-5 py-3 text-sm"
        >
          Chat with Sage
        </Link>
      </div>
    );
  }

  const haveSkills = analysis.skills.filter((s) => s.status === "have");
  const buildingSkills = analysis.skills.filter((s) => s.status === "building");
  const needSkills = analysis.skills.filter((s) => s.status === "need");
  const total = analysis.skills.length;

  return (
    <div className="surface-section p-5">
      <div className="mb-4">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
          Skill Gap Analysis
        </p>
        <p className="mt-1 text-base font-semibold text-[var(--ink-strong)]">
          {analysis.targetClusterName}
        </p>
      </div>

      <ReadinessBar
        haveCount={analysis.haveCount}
        buildingCount={analysis.buildingCount}
        needCount={analysis.needCount}
        total={total}
        readinessPercent={analysis.readinessPercent}
      />

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Column
          title="Have"
          count={analysis.haveCount}
          skills={haveSkills}
          headerClass="bg-emerald-50 text-emerald-800"
          emptyText="No matched skills yet — complete your career discovery."
        />
        <Column
          title="Building"
          count={analysis.buildingCount}
          skills={buildingSkills}
          headerClass="bg-amber-50 text-amber-800"
          emptyText="Start a certification to see skills in progress."
        />
        <Column
          title="Need"
          count={analysis.needCount}
          skills={needSkills}
          headerClass="bg-red-50 text-red-800"
          emptyText="Great — no skill gaps identified."
        />
      </div>
    </div>
  );
}
