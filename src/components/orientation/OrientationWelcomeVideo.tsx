"use client";

import { useEffect, useState } from "react";
import { useProgression } from "@/components/progression/ProgressionProvider";
import {
  WELCOME_VIDEO_ORIENTATION_ITEM_ID,
  WELCOME_VIDEO_XP,
} from "@/lib/orientation-welcome-video";

export default function OrientationWelcomeVideo() {
  const { checkProgression } = useProgression();
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [awarded, setAwarded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/orientation")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const item = data?.items?.find((candidate: { id: string }) => candidate.id === WELCOME_VIDEO_ORIENTATION_ITEM_ID);
        setCompleted(Boolean(item?.completed));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function markVideoComplete() {
    if (completed || saving) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/orientation/welcome-video", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't record your video completion. Please try again.");
        return;
      }
      setCompleted(true);
      setAwarded(Boolean(data.awarded));
      await fetch("/api/orientation/complete", { method: "POST" }).catch(() => {});
      await checkProgression();
    } catch {
      setError("We couldn't record your video completion. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="orientation-welcome-title"
      className="surface-section mb-6 overflow-hidden p-5 sm:p-6"
    >
      <div className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent-secondary)]">
          Meet Sage
        </p>
        <h2 id="orientation-welcome-title" className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
          Welcome to VisionQuest
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          Watch this short video to complete the Sage welcome step in Orientation. You&apos;ll earn a one-time {WELCOME_VIDEO_XP} XP reward.
        </p>
      </div>

      <video
        className="mt-5 aspect-video w-full rounded-xl bg-black shadow-sm"
        controls
        playsInline
        preload="metadata"
        onEnded={markVideoComplete}
      >
        <source src="/media/sage-welcome-orientation.mp4" type="video/mp4" />
        <track
          kind="captions"
          src="/media/sage-welcome-orientation.vtt"
          srcLang="en"
          label="English"
          default
        />
        Your browser does not support the welcome video. You can download it below.
      </video>

      <div className="mt-3" aria-live="polite">
        {completed ? (
          <p className="text-sm font-semibold text-emerald-700">
            {awarded ? `Welcome video complete — ${WELCOME_VIDEO_XP} XP added.` : "Welcome video complete."}
          </p>
        ) : (
          <p className="text-sm text-[var(--ink-muted)]">Finish the video to complete this Orientation step and earn {WELCOME_VIDEO_XP} XP.</p>
        )}
        {error && <p role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <a
          href="/media/sage-welcome-orientation.mp4"
          download
          className="font-semibold text-[var(--accent-secondary)] hover:underline"
        >
          Download the welcome video
        </a>
        <details className="text-[var(--ink-muted)]">
          <summary className="cursor-pointer font-semibold text-[var(--accent-secondary)] hover:underline">
            Read the welcome transcript
          </summary>
          <div className="mt-3 max-w-3xl space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm leading-6">
            <p>Welcome to VisionQuest — your starting point for building a path toward your goals.</p>
            <p>Through SPOKES, you&apos;ll have the support, skills, and structure to move forward.</p>
            <p>This is true if you&apos;re preparing for work. It&apos;s true if you&apos;re continuing your education. And it&apos;s true if you want more stability for your family.</p>
            <p>I&apos;m Sage. I&apos;m here to guide you, answer your questions, and help you stay on track.</p>
            <p>Your Dashboard is your home base. Set goals that matter to you, track your progress, and always see what comes next.</p>
            <p>Together, we&apos;ll find courses and chances that fit your goals.</p>
            <p>We&apos;ll help you earn your SPOKES Ready to Work Certification.</p>
            <p>One clear next step at a time. Every step you take matters — and you don&apos;t have to figure it out alone.</p>
            <p>Welcome to VisionQuest. Let&apos;s begin building your path forward.</p>
          </div>
        </details>
      </div>
    </section>
  );
}
