"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import XpToast from "@/components/ui/XpToast";
import AchievementUnlock from "@/components/ui/AchievementUnlock";
import LevelUpCelebration from "@/components/ui/LevelUpCelebration";

interface ProgressionContextValue {
  checkProgression: () => Promise<void>;
}

const ProgressionContext = createContext<ProgressionContextValue>({
  checkProgression: async () => {},
});

export function useProgression() {
  return useContext(ProgressionContext);
}

interface CelebrationItem {
  type: "xp" | "achievement" | "levelup";
  // for xp
  amount?: number;
  xpLabel?: string;
  // for achievement
  label?: string;
  desc?: string;
  // for levelup
  newLevel?: number;
}

export default function ProgressionProvider({ children }: { children: ReactNode }) {
  const prevStateRef = useRef<{ xp: number; level: number; achievements: string[] } | null>(null);
  const [, setQueue] = useState<CelebrationItem[]>([]);
  const [current, setCurrent] = useState<CelebrationItem | null>(null);
  const processingRef = useRef(false);

  const handleDone = useCallback(() => {
    processingRef.current = false;
    setCurrent(null);
    // Process next item after a brief delay
    setTimeout(() => {
      setQueue((prev) => {
        if (prev.length === 0) return prev;
        processingRef.current = true;
        setCurrent(prev[0]);
        return prev.slice(1);
      });
    }, 300);
  }, []);

  const checkProgression = useCallback(async () => {
    try {
      const res = await fetch("/api/progression");
      if (!res.ok) return;
      const data = await res.json();

      const prev = prevStateRef.current;
      const newItems: CelebrationItem[] = [];

      if (prev) {
        // Check level up
        if (data.level > prev.level) {
          newItems.push({ type: "levelup", newLevel: data.level });
        }

        // Check new achievements
        const prevSet = new Set(prev.achievements);
        const newAchievements = (data.achievementsWithDefs || []).filter(
          (a: { key: string }) => !prevSet.has(a.key)
        );
        for (const ach of newAchievements) {
          newItems.push({ type: "achievement", label: ach.label, desc: ach.desc });
        }

        // Check XP gain
        const xpDelta = data.xp - prev.xp;
        if (xpDelta > 0) {
          newItems.push({ type: "xp", amount: xpDelta });
        }
      }

      // Update stored state
      prevStateRef.current = {
        xp: data.xp,
        level: data.level,
        achievements: (data.achievementsWithDefs || []).map((a: { key: string }) => a.key),
      };

      if (newItems.length > 0) {
        setQueue((prev) => [...prev, ...newItems]);
        // Trigger processing if not already running
        if (!processingRef.current) {
          processingRef.current = true;
          setCurrent(newItems[0]);
          setQueue((prev) => prev.slice(1));
        }
      }
    } catch {
      // Ignore fetch errors
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialProgression() {
      try {
        const res = await fetch("/api/progression");
        if (!res.ok || cancelled) return;

        const data = await res.json();
        if (cancelled) return;

        prevStateRef.current = {
          xp: data.xp,
          level: data.level,
          achievements: (data.achievementsWithDefs || []).map((a: { key: string }) => a.key),
        };
      } catch {
        // Ignore init errors
      }
    }

    void loadInitialProgression();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ProgressionContext.Provider value={{ checkProgression }}>
      {children}

      {/* Celebration portal */}
      {current?.type === "levelup" && current.newLevel && (
        <LevelUpCelebration newLevel={current.newLevel} onDone={handleDone} />
      )}
      {current?.type === "achievement" && current.label && current.desc && (
        <AchievementUnlock label={current.label} desc={current.desc} onDone={handleDone} />
      )}
      {current?.type === "xp" && current.amount && (
        <XpToast amount={current.amount} label={current.xpLabel} onDone={handleDone} />
      )}
    </ProgressionContext.Provider>
  );
}
