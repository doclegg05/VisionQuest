"use client";

import { useState } from "react";
import type { SpokesPlatform } from "@/lib/spokes/platforms";

interface PlatformCardProps {
  platform: SpokesPlatform;
  goalMatch?: boolean;
  onVisit?: (id: string) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  "certification-prep": "from-orange-400 to-amber-500",
  "academic-hse": "from-blue-400 to-indigo-500",
  "esl-language": "from-emerald-400 to-teal-500",
  "career-skills": "from-violet-400 to-purple-500",
  "work-ethic": "from-rose-400 to-pink-500",
  "career-readiness": "from-cyan-400 to-sky-500",
};

export default function PlatformCard({
  platform,
  goalMatch = false,
  onVisit,
}: PlatformCardProps) {
  const [linksOpen, setLinksOpen] = useState(false);

  const studentLinks = platform.links.filter(
    (l) => l.audience === "student" || l.audience === "both"
  );

  const gradientClass =
    CATEGORY_COLORS[platform.category] || "from-gray-400 to-gray-500";

  function handleVisit() {
    if (platform.loginUrl) {
      onVisit?.(platform.id);
      window.open(platform.loginUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div
      className={`surface-section relative overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        goalMatch ? "ring-2 ring-[var(--accent-strong)]" : ""
      }`}
    >
      {/* Gradient glow strip */}
      <div
        className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${gradientClass}`}
      />

      <div className="p-5 pt-4">
        {/* Goal match badge */}
        {goalMatch && (
          <div className="mb-3">
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[var(--accent-strong)] text-white">
              Matches your goals
            </span>
          </div>
        )}

        {/* Header: icon + name + description */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 h-12 w-12 rounded-full bg-[var(--ink-strong)] flex items-center justify-center text-xl">
            {platform.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-base font-semibold text-[var(--ink-strong)]">
              {platform.name}
            </h3>
            <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
              {platform.description}
            </p>
          </div>
        </div>

        {/* Certification badges */}
        {platform.certifications.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {platform.certifications.map((cert) => (
              <span
                key={cert}
                className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-secondary)]/15 text-[var(--accent-secondary)] font-medium"
              >
                {cert.replace(/-/g, " ")}
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex items-center gap-3">
          {platform.loginUrl ? (
            <button
              onClick={handleVisit}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-strong)] hover:underline cursor-pointer"
            >
              Open Platform &rarr;
            </button>
          ) : (
            <span className="text-xs text-[var(--muted)] italic">
              Classroom-based platform
            </span>
          )}

          {studentLinks.length > 0 && (
            <button
              onClick={() => setLinksOpen(!linksOpen)}
              className="text-xs text-[var(--muted)] hover:text-[var(--ink-strong)] transition-colors cursor-pointer"
            >
              {linksOpen ? "Less resources \u25B4" : "More resources \u25BE"}
            </button>
          )}
        </div>

        {/* Expandable links */}
        {linksOpen && studentLinks.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--muted)]/20 space-y-1.5">
            {studentLinks.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-[var(--accent-secondary)] hover:underline"
              >
                {link.label} &nearr;
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
