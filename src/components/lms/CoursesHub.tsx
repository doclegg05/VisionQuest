"use client";

import { useState, useEffect, useCallback } from "react";
import type { SpokesPlatform, PlatformCategory } from "@/lib/spokes/platforms";
import { PLATFORM_CATEGORIES } from "@/lib/spokes/platforms";
import PlatformFilter from "./PlatformFilter";
import PlatformCategorySection from "./PlatformCategorySection";
import { useProgression } from "@/components/progression/ProgressionProvider";

const ALL_CATEGORIES = Object.keys(PLATFORM_CATEGORIES) as PlatformCategory[];

export default function CoursesHub() {
  const { checkProgression } = useProgression();
  const [platforms, setPlatforms] = useState<SpokesPlatform[]>([]);
  const [goalMatches, setGoalMatches] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<
    PlatformCategory | "all"
  >("all");
  const [showGoalMatch, setShowGoalMatch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlatforms = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/lms/platforms");
      if (!res.ok) throw new Error("Failed to load platforms");
      const data = await res.json();
      setPlatforms(data.platforms || []);
      setGoalMatches(data.goalMatches || []);
      setError(null);
    } catch (err) {
      console.error("Failed to load platforms:", err);
      setError("Failed to load platforms. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlatforms();
  }, [fetchPlatforms]);

  const handleVisit = useCallback((platformId: string) => {
    // Fire-and-forget: don't block UI
    fetch("/api/lms/platforms/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platformId }),
    })
      .then(() => setTimeout(() => checkProgression(), 500))
      .catch(() => {
        // Silently fail — visit tracking is non-critical
      });
  }, [checkProgression]);

  // Filter platforms
  const filtered = platforms.filter((p) => {
    if (showGoalMatch && !goalMatches.includes(p.id)) return false;
    if (selectedCategory !== "all" && p.category !== selectedCategory)
      return false;
    return true;
  });

  // Group by category (preserving order)
  const grouped = ALL_CATEGORIES.reduce<
    { category: PlatformCategory; items: SpokesPlatform[] }[]
  >((acc, cat) => {
    const items = filtered.filter((p) => p.category === cat);
    if (items.length > 0) acc.push({ category: cat, items });
    return acc;
  }, []);

  // Determine which categories have platforms (for filter chips)
  const activeCategories = ALL_CATEGORIES.filter((cat) =>
    platforms.some((p) => p.category === cat)
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="surface-section h-32 animate-pulse opacity-40"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface-section p-8 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={fetchPlatforms}
          className="px-4 py-2 bg-[var(--accent-strong)] text-white rounded-lg hover:opacity-90 transition-opacity cursor-pointer"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (platforms.length === 0) {
    return (
      <div className="surface-section p-8 text-center">
        <p className="text-4xl mb-3">📚</p>
        <p className="text-sm text-[var(--ink-muted)]">
          No learning platforms available yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PlatformFilter
        categories={activeCategories}
        selected={selectedCategory}
        onSelect={(cat) => {
          setSelectedCategory(cat);
          if (showGoalMatch) setShowGoalMatch(false);
        }}
        goalMatchCount={goalMatches.length}
        showGoalMatch={showGoalMatch}
        onToggleGoalMatch={() => {
          setShowGoalMatch(!showGoalMatch);
          if (!showGoalMatch) setSelectedCategory("all");
        }}
      />

      {grouped.length === 0 ? (
        <div className="surface-section p-8 text-center">
          <p className="text-sm text-[var(--ink-muted)]">
            No platforms match your current filter.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ category, items }) => (
            <PlatformCategorySection
              key={category}
              category={category}
              platforms={items}
              goalMatches={goalMatches}
              onVisit={handleVisit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
