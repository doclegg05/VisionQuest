import { Brain } from "@phosphor-icons/react";

export interface SageMemoryEntry {
  id: string;
  content: string;
  category: string;
  sourceType: string;
  createdAt: string;
}

interface SageMemoryListProps {
  memories: SageMemoryEntry[];
}

// Matches the SageMemory.category values in prisma/schema.prisma
// (goal | preference | circumstance | skill | coaching | progress | other).
// Order here is display order — goals and coaching first, since those are
// what a student is most likely to want to check.
const CATEGORY_ORDER = ["goal", "coaching", "progress", "skill", "circumstance", "preference", "other"];

const CATEGORY_LABELS: Record<string, string> = {
  goal: "Your goals",
  coaching: "Coaching notes",
  progress: "Your progress",
  skill: "Skills you have",
  circumstance: "Your situation",
  preference: "Things you like",
  other: "Other notes",
};

// Matches SageMemory.sourceType (conversation | operation | manual).
const SOURCE_LABELS: Record<string, string> = {
  conversation: "From a chat with Sage",
  operation: "From something Sage helped you do",
  manual: "Added by your teacher",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? "Other notes";
}

function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? "From Sage";
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function groupByCategory(memories: SageMemoryEntry[]): Array<{ category: string; items: SageMemoryEntry[] }> {
  const buckets = new Map<string, SageMemoryEntry[]>();
  for (const memory of memories) {
    const key = CATEGORY_LABELS[memory.category] ? memory.category : "other";
    const existing = buckets.get(key);
    if (existing) {
      existing.push(memory);
    } else {
      buckets.set(key, [memory]);
    }
  }
  return CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
    category,
    items: buckets.get(category) ?? [],
  }));
}

/**
 * What Sage remembers about this student, in the student's own words —
 * grouped by category with a dignified empty state. Read-only: correction
 * happens through the student's teacher (see SageMemoryPanel's guidance
 * text), matching the existing staff governance model for this data
 * (GET/PATCH/DELETE /api/teacher/students/[id]/memories).
 */
export function SageMemoryList({ memories }: SageMemoryListProps) {
  if (memories.length === 0) {
    return (
      <div className="theme-card flex flex-col items-center gap-3 rounded-xl p-8 text-center">
        <Brain size={32} weight="duotone" className="text-[var(--ink-faint)]" />
        <p className="text-sm font-semibold text-[var(--ink-strong)]">
          Sage has not written any notes about you yet.
        </p>
        <p className="max-w-sm text-sm text-[var(--ink-muted)]">
          Keep chatting with Sage. Short notes will start showing up here.
        </p>
      </div>
    );
  }

  const groups = groupByCategory(memories);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.category} aria-labelledby={`memory-group-${group.category}`}>
          <h2
            id={`memory-group-${group.category}`}
            className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-secondary)]"
          >
            {categoryLabel(group.category)}
          </h2>
          <ul className="mt-2 space-y-2">
            {group.items.map((memory) => (
              <li key={memory.id} className="theme-input rounded-lg p-3">
                <p className="text-sm text-[var(--ink-strong)]">{memory.content}</p>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {sourceLabel(memory.sourceType)} · {formatDate(memory.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
