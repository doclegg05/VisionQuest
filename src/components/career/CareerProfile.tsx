"use client";

import Link from "next/link";
import type { CareerDiscoveryData } from "@/lib/career-discovery";
import type { RiasecScores, NationalClusterScore, TransferableSkill, WorkValue } from "@/lib/sage/discovery-extractor";
import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CareerProfileProps {
  discovery: CareerDiscoveryData;
}

// ─── RIASEC Radar Chart ───────────────────────────────────────────────────────

const RIASEC_LABELS: { key: keyof RiasecScores; label: string; abbr: string }[] = [
  { key: "realistic",     label: "Realistic",     abbr: "R" },
  { key: "investigative", label: "Investigative", abbr: "I" },
  { key: "artistic",      label: "Artistic",      abbr: "A" },
  { key: "social",        label: "Social",        abbr: "S" },
  { key: "enterprising",  label: "Enterprising",  abbr: "E" },
  { key: "conventional",  label: "Conventional",  abbr: "C" },
];

const CHART_SIZE = 260;
const CENTER = CHART_SIZE / 2;
const MAX_RADIUS = 96;
const LABEL_OFFSET = 18;

function toPoint(angleDeg: number, radius: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

function RadarChart({ scores }: { scores: RiasecScores }) {
  const ringLevels = [0.25, 0.5, 0.75, 1.0];
  const n = RIASEC_LABELS.length;
  const angleStep = 360 / n;

  // Axis endpoints
  const axes = RIASEC_LABELS.map((_, i) => toPoint(i * angleStep, MAX_RADIUS));

  // Score polygon
  const polygonPoints = RIASEC_LABELS.map(({ key }, i) => {
    const r = Math.min(1, Math.max(0, scores[key])) * MAX_RADIUS;
    return toPoint(i * angleStep, r);
  });

  const polyPath = polygonPoints
    .map(([x, y], idx) => `${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ") + " Z";

  return (
    <svg
      viewBox={`0 0 ${CHART_SIZE} ${CHART_SIZE}`}
      width={CHART_SIZE}
      height={CHART_SIZE}
      aria-label="RIASEC radar chart"
      role="img"
      className="mx-auto"
    >
      {/* Background rings */}
      {ringLevels.map((level) => {
        const ringPoints = RIASEC_LABELS.map((_, i) =>
          toPoint(i * angleStep, level * MAX_RADIUS),
        );
        const ringPath =
          ringPoints
            .map(([x, y], idx) => `${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
            .join(" ") + " Z";
        return (
          <path
            key={level}
            d={ringPath}
            fill="none"
            stroke="var(--border)"
            strokeWidth="1"
          />
        );
      })}

      {/* Axis spokes */}
      {axes.map(([ax, ay], i) => (
        <line
          key={i}
          x1={CENTER}
          y1={CENTER}
          x2={ax}
          y2={ay}
          stroke="var(--border)"
          strokeWidth="1"
        />
      ))}

      {/* Score polygon fill */}
      <path
        d={polyPath}
        fill="rgba(42,138,60,0.18)"
        stroke="var(--accent-strong)"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Score dots */}
      {polygonPoints.map(([px, py], i) => (
        <circle key={i} cx={px} cy={py} r="3.5" fill="var(--accent-strong)" />
      ))}

      {/* Labels */}
      {RIASEC_LABELS.map(({ abbr }, i) => {
        const [lx, ly] = toPoint(i * angleStep, MAX_RADIUS + LABEL_OFFSET);
        return (
          <text
            key={i}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="11"
            fontWeight="700"
            fill="var(--ink-strong)"
            letterSpacing="0.05em"
          >
            {abbr}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Section A: RIASEC ────────────────────────────────────────────────────────

function RiasecSection({
  scores,
  hollandCode,
}: {
  scores: RiasecScores;
  hollandCode: string | null;
}) {
  return (
    <div className="surface-section p-5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
        Holland Interest Profile
      </p>
      {hollandCode && (
        <div className="mt-2 flex items-baseline gap-3">
          <span className="font-display text-5xl font-bold text-[var(--accent-strong)]">
            {hollandCode}
          </span>
          <span className="text-sm text-[var(--ink-muted)]">Holland Code</span>
        </div>
      )}

      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <RadarChart scores={scores} />

        <div className="w-full space-y-2 sm:pt-2">
          {RIASEC_LABELS.map(({ key, label }) => {
            const pct = Math.round(scores[key] * 100);
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--ink-strong)]">{label}</span>
                  <span className="text-[var(--ink-muted)]">{pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent-strong)]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Section B: Transferable Skills ──────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  communication:  "bg-sky-100 text-sky-800",
  organization:   "bg-violet-100 text-violet-800",
  technical:      "bg-cyan-100 text-cyan-800",
  interpersonal:  "bg-rose-100 text-rose-800",
  analytical:     "bg-amber-100 text-amber-800",
  leadership:     "bg-emerald-100 text-emerald-800",
};

function SkillsSection({ skills }: { skills: TransferableSkill[] }) {
  if (skills.length === 0) return null;

  const grouped: Record<string, TransferableSkill[]> = {};
  for (const skill of skills) {
    if (!grouped[skill.category]) grouped[skill.category] = [];
    grouped[skill.category].push(skill);
  }

  return (
    <div className="surface-section p-5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
        Transferable Skills
      </p>
      <div className="mt-4 space-y-5">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${CATEGORY_COLORS[category] ?? "bg-[var(--surface-interactive)] text-[var(--ink-strong)]"}`}
            >
              {category}
            </span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {items.map((s) => (
                <div
                  key={s.skill}
                  className="rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)]/70 p-3"
                >
                  <p className="text-sm font-semibold text-[var(--ink-strong)]">{s.skill}</p>
                  {s.evidence && (
                    <p className="mt-1 text-xs italic text-[var(--ink-muted)]">
                      &ldquo;{s.evidence}&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Section C: Work Values ───────────────────────────────────────────────────

const IMPORTANCE_WIDTH: Record<WorkValue["importance"], string> = {
  high:   "w-full",
  medium: "w-3/5",
  low:    "w-1/3",
};

function ValuesSection({ values }: { values: WorkValue[] }) {
  const top5 = values.slice(0, 5);
  if (top5.length === 0) return null;

  return (
    <div className="surface-section p-5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
        Work Values
      </p>
      <ol className="mt-4 space-y-3">
        {top5.map((v, idx) => (
          <li key={v.value} className="flex items-center gap-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[rgba(42,138,60,0.1)] text-xs font-bold text-[var(--accent-strong)]">
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold capitalize text-[var(--ink-strong)]">
                  {v.value.replace(/-/g, " ")}
                </span>
                <span className="text-xs text-[var(--ink-muted)]">{v.importance}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                <div
                  className={`h-full rounded-full bg-[var(--primary)] ${IMPORTANCE_WIDTH[v.importance]}`}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Section D: Career Clusters ───────────────────────────────────────────────

function ClustersSection({ clusters }: { clusters: NationalClusterScore[] }) {
  const top3 = clusters
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (top3.length === 0) return null;

  return (
    <div className="surface-section p-5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
        Top Career Clusters
      </p>
      <div className="mt-4 space-y-4">
        {top3.map((nc, rank) => {
          const matchPct = Math.round(nc.score * 100);
          // Find first matching SPOKES cluster for sample jobs
          const spokesMatch = nc.spokes_mapping
            .map((id) => CAREER_CLUSTERS.find((c) => c.id === id))
            .find(Boolean);

          return (
            <div
              key={nc.cluster_name}
              className="rounded-[1.2rem] border border-[var(--border)] bg-[var(--surface-raised)]/70 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[rgba(0,123,175,0.12)] text-xs font-bold text-[var(--primary)]">
                    {rank + 1}
                  </span>
                  <p className="font-semibold text-[var(--ink-strong)]">{nc.cluster_name}</p>
                </div>
                <span className="flex-shrink-0 rounded-full bg-[rgba(42,138,60,0.1)] px-2.5 py-0.5 text-xs font-bold text-[var(--accent-strong)]">
                  {matchPct}% match
                </span>
              </div>

              {spokesMatch && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-semibold text-[var(--ink-muted)]">
                    Sample jobs
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {spokesMatch.sampleJobs.slice(0, 4).map((job) => (
                      <span
                        key={job}
                        className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-0.5 text-xs text-[var(--ink-muted)]"
                      >
                        {job}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CareerProfile({ discovery }: CareerProfileProps) {
  const { riasecScores, hollandCode, transferableSkills, workValues, nationalClusters } =
    discovery;

  return (
    <div className="space-y-4">
      {/* Section A: RIASEC */}
      {riasecScores && (
        <RiasecSection scores={riasecScores} hollandCode={hollandCode} />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Section B: Skills */}
        {transferableSkills && transferableSkills.length > 0 && (
          <div className="md:col-span-2">
            <SkillsSection skills={transferableSkills} />
          </div>
        )}

        {/* Section C: Values */}
        {workValues && workValues.length > 0 && (
          <ValuesSection values={workValues} />
        )}

        {/* Section D: Career Clusters */}
        {nationalClusters && nationalClusters.length > 0 && (
          <ClustersSection clusters={nationalClusters} />
        )}
      </div>

      {/* Section E: Discuss with Sage CTA */}
      <div className="surface-section p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-[var(--ink-strong)]">
              Want to explore your results with Sage?
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Sage can help you connect your Career DNA to real goals and next steps.
            </p>
          </div>
          <Link
            href="/chat?stage=career_profile_review"
            prefetch={false}
            className="primary-button shrink-0 px-5 py-3 text-sm"
          >
            Talk to Sage
          </Link>
        </div>
      </div>
    </div>
  );
}
