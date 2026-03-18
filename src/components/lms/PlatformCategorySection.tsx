import PlatformCard from "./PlatformCard";
import type { SpokesPlatform, PlatformCategory } from "@/lib/spokes/platforms";
import { PLATFORM_CATEGORIES } from "@/lib/spokes/platforms";

interface PlatformCategorySectionProps {
  category: PlatformCategory;
  platforms: SpokesPlatform[];
  goalMatches: string[];
  onVisit: (id: string) => void;
}

export default function PlatformCategorySection({
  category,
  platforms,
  goalMatches,
  onVisit,
}: PlatformCategorySectionProps) {
  const meta = PLATFORM_CATEGORIES[category];

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xl">{meta.icon}</span>
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--ink-strong)]">
            {meta.label}
          </h2>
          <p className="text-xs text-[var(--muted)]">{meta.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {platforms.map((p) => (
          <PlatformCard
            key={p.id}
            platform={p}
            goalMatch={goalMatches.includes(p.id)}
            onVisit={onVisit}
          />
        ))}
      </div>
    </section>
  );
}
