"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface CredlyBadge {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  issuedAt: string;
  issuerName: string;
  badgeUrl: string;
}

export default function CredlyBadges() {
  const [badges, setBadges] = useState<CredlyBadge[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/credly/badges")
      .then((res) => res.json())
      .then((data) => {
        setBadges(data.badges || []);
        setUsername(data.username || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  if (!username) {
    return (
      <div className="surface-section p-5">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="text-3xl">🏅</span>
          <h3 className="font-display text-lg text-[var(--ink-strong)]">Display Your Earned Badges</h3>
          <p className="max-w-md text-sm text-[var(--ink-muted)]">
            Connect your Credly profile to automatically display certification badges you&apos;ve earned
            from Certiport exams (IC3, MOS, QuickBooks, IT Specialist, and more).
          </p>
          <Link
            href="/settings"
            className="primary-button mt-2 px-5 py-2.5 text-sm"
          >
            Connect Credly in Settings
          </Link>
        </div>
      </div>
    );
  }

  if (badges.length === 0) {
    return (
      <div className="surface-section p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Credly profile</p>
            <h3 className="mt-1 font-display text-lg text-[var(--ink-strong)]">Digital Badges</h3>
          </div>
          <a
            href={`https://www.credly.com/users/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-[var(--accent-secondary)] hover:underline"
          >
            View on Credly
          </a>
        </div>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          No badges found yet. Badges appear here automatically after you pass a Certiport exam and accept the badge on Credly.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-section p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Credly profile</p>
          <h3 className="mt-1 font-display text-lg text-[var(--ink-strong)]">
            Digital Badges ({badges.length})
          </h3>
        </div>
        <a
          href={`https://www.credly.com/users/${username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-[var(--accent-secondary)] hover:underline"
        >
          View on Credly
        </a>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {badges.map((badge) => (
          <a
            key={badge.id}
            href={badge.badgeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-2 rounded-xl border border-[var(--border)] bg-white/60 p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            {badge.imageUrl ? (
              <img
                src={badge.imageUrl}
                alt={badge.name}
                width={80}
                height={80}
                className="h-20 w-20 object-contain"
              />
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-full bg-[rgba(16,37,62,0.06)] text-3xl">
                🏅
              </div>
            )}
            <p className="text-xs font-semibold leading-4 text-[var(--ink-strong)] group-hover:text-[var(--accent-secondary)]">
              {badge.name}
            </p>
            {badge.issuerName && (
              <p className="text-[10px] text-[var(--ink-muted)]">{badge.issuerName}</p>
            )}
            {badge.issuedAt && (
              <p className="text-[10px] text-[var(--ink-muted)]">
                {new Date(badge.issuedAt).toLocaleDateString()}
              </p>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
