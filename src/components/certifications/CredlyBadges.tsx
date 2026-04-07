"use client";

import { useState, useEffect } from "react";

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

  // Self-configuration state
  const [inputValue, setInputValue] = useState("");
  const [connectStatus, setConnectStatus] = useState<"idle" | "saving" | "success" | "error">("idle");

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

  const handleConnect = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    setConnectStatus("saving");
    try {
      const res = await fetch("/api/settings/credly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credlyUsername: trimmed }),
      });
      if (res.ok) {
        const data = await res.json() as { credlyUsername: string };
        setUsername(data.credlyUsername);
        setInputValue("");
        setConnectStatus("success");
        setTimeout(() => setConnectStatus("idle"), 3000);

        // Refetch badges now that the username is saved
        fetch("/api/credly/badges")
          .then((r) => r.json())
          .then((badgeData) => {
            setBadges(badgeData.badges || []);
          })
          .catch(() => {});
      } else {
        setConnectStatus("error");
      }
    } catch {
      setConnectStatus("error");
    }
  };

  if (loading) return null;

  if (!username) {
    return (
      <div className="surface-section p-5">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Digital credentials</p>
          <h3 className="mt-1 font-display text-lg text-[var(--ink-strong)]">Connect Your Credly Badges</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            When you pass a Certiport certification exam (IC3, MOS, QuickBooks, IT Specialist), you earn a
            digital badge through Credly. Connect your profile to display them here automatically.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              step: "1",
              title: "Pass a certification exam",
              desc: "Complete any Certiport exam through GMetrix or your testing center.",
            },
            {
              step: "2",
              title: "Check your email",
              desc: "Credly sends an email to accept your badge. Look for \"You've earned a badge\" from Credly.",
            },
            {
              step: "3",
              title: "Accept & create your profile",
              desc: "Click the link in the email to accept the badge. This creates your Credly profile at credly.com.",
            },
            {
              step: "4",
              title: "Connect below",
              desc: "Paste your Credly profile URL or username below and click Connect.",
            },
          ].map((item) => (
            <div key={item.step} className="theme-card rounded-xl/60 p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent-strong)] text-xs font-bold text-white">
                  {item.step}
                </span>
                <p className="text-sm font-semibold text-[var(--ink-strong)]">{item.title}</p>
              </div>
              <p className="text-xs leading-5 text-[var(--ink-muted)]">{item.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 theme-card rounded-xl/60 p-4">
          <label htmlFor="credly-username" className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
            Credly username or profile URL
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="credly-username"
              type="text"
              placeholder="e.g., jane-doe or https://www.credly.com/users/jane-doe"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setConnectStatus("idle");
              }}
              className="field flex-1 px-4 py-3 text-sm"
            />
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={!inputValue.trim() || connectStatus === "saving"}
              className="primary-button px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {connectStatus === "saving" ? "Connecting..." : "Connect Credly"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-[var(--ink-muted)]">
            Go to credly.com, click your name in the top-right, then &quot;View Profile.&quot; Copy the URL — it should look like credly.com/users/your-name.
          </p>
          {connectStatus === "success" && (
            <p className="mt-2 text-sm text-emerald-600">Credly profile connected!</p>
          )}
          {connectStatus === "error" && (
            <p className="mt-2 text-sm text-red-600">Could not connect your Credly profile. Please check the username and try again.</p>
          )}
        </div>

        <div className="mt-3">
          <a
            href="https://www.credly.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[var(--accent-secondary)] hover:underline"
          >
            Visit credly.com to find your profile
          </a>
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
            className="group flex flex-col items-center gap-2 theme-card rounded-xl/60 p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            {badge.imageUrl ? (
              <img
                src={badge.imageUrl}
                alt={badge.name}
                width={80}
                height={80}
                loading="lazy"
                decoding="async"
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
              <p className="text-xs text-[var(--ink-muted)]">{badge.issuerName}</p>
            )}
            {badge.issuedAt && (
              <p className="text-xs text-[var(--ink-muted)]">
                {new Date(badge.issuedAt).toLocaleDateString()}
              </p>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
