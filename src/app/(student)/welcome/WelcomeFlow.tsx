"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type WelcomePath } from "@/lib/progression/welcome-routing";

interface QuickWinItemData {
  id: string;
  label: string;
  description: string | null;
}

interface WelcomeFlowProps {
  studentName: string;
  quickWinItems?: QuickWinItemData[];
  /** Real orientation item count — the same total /api/orientation reports. */
  totalOrientationItems: number;
  /** Items already completed before this flow started (default 0 — new
   *  students reach this screen with a clean slate, but never assume it). */
  completedOrientationCount?: number;
}

const TOTAL_STEPS = 4;

/**
 * How long the score card holds before the flow moves on.
 *
 * Eight seconds, not two (owner call, 2026-08-20). The card is the student's
 * only confirmation that their first quick-win actually saved, and at the
 * grade-5 reading level this program serves, two seconds did not cover reading
 * one sentence and a count — the celebration was gone before it was read. The
 * timer stays because the student can already leave sooner: QuickWinsNav is on
 * screen the whole time and every manual navigation revokes this advance.
 *
 * Exported so the floor is testable — this is a product decision, not a tuning
 * knob to trim when something feels slow.
 */
export const SCORE_ADVANCE_DELAY_MS = 8000;

type ScheduleFn = (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
type CancelFn = (handle: ReturnType<typeof setTimeout>) => void;

export interface AutoAdvance {
  start(callback: () => void, delayMs: number): void;
  cancel(): void;
}

/**
 * The quick-wins celebration's auto-advance, as a handle the flow can revoke.
 *
 * The celebration keeps its navigation on screen, so the student can leave
 * before the timer fires — and an escape hatch that drops them somewhere else
 * two seconds later is not an escape hatch. Every manual navigation cancels
 * the pending advance. The scheduler is injectable so the cancel path is
 * unit-testable without a DOM or a real clock. Exported for tests.
 */
export function createAutoAdvance(
  schedule: ScheduleFn = setTimeout,
  cancel: CancelFn = clearTimeout,
): AutoAdvance {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    start(callback, delayMs) {
      if (handle !== null) cancel(handle);
      handle = schedule(() => {
        handle = null;
        callback();
      }, delayMs);
    },
    cancel() {
      if (handle === null) return;
      cancel(handle);
      handle = null;
    },
  };
}

/**
 * Posts a single quick-win orientation item as complete. Returns whether the
 * save succeeded — never throws — so the caller can show a retry affordance
 * instead of silently discarding the failure. Exported for tests.
 */
export async function postQuickWinCompletion(
  itemId: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn("/api/orientation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, completed: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Orientation-item completion percentage for the "your first wins" step's
 * progress bar, derived from the real orientation item count — never a
 * hardcoded total. Returns null when the total is unknown/zero so the caller
 * shows count-free encouragement instead of a fabricated percentage.
 *
 * Named for what it actually measures — a share of orientation items — not
 * "readiness": that word is reserved for the dashboard's 100-point composite
 * score, which this number does not match and was never meant to represent.
 * Exported for tests.
 */
export function computeOrientationCompletionPercent(
  totalOrientationItems: number,
  completedOrientationCount: number,
  completedWinsCount: number,
): number | null {
  if (totalOrientationItems <= 0) return null;
  return Math.round(((completedOrientationCount + completedWinsCount) / totalOrientationItems) * 100);
}

export interface WelcomePathChoice {
  path: WelcomePath;
  href: string;
  title: string;
  description: string;
  icon: string;
  /** The one card the flow steers toward. */
  recommended?: boolean;
}

/**
 * The last step's three doors. Each carries the `path` value recorded with the
 * completion fact, so the thing the student clicked and the thing the ledger
 * remembers can never drift apart. Exported for tests.
 */
export const WELCOME_PATH_CHOICES: readonly WelcomePathChoice[] = [
  {
    path: "chat",
    href: "/chat",
    icon: "💬",
    title: "Discover My Career Path",
    description:
      "Start a conversation with Sage. Explore your strengths and skills, and find a career goal that fits.",
    recommended: true,
  },
  {
    path: "orientation",
    href: "/orientation",
    icon: "📋",
    title: "Finish Orientation",
    description:
      "Review and complete required SPOKES program forms and onboarding checklist items.",
  },
  {
    path: "dashboard",
    href: "/dashboard",
    icon: "📊",
    title: "View My Employment Journey Map",
    description:
      "Go directly to your dashboard to see your 8-step path to employment.",
  },
];

/**
 * Records that the student finished the welcome flow, and which door they took.
 *
 * This is what stops the next page from sending them straight back here: with
 * no goals, no conversation and (if they skipped the quick wins) no orientation
 * progress, the recorded fact is the ONLY thing that distinguishes "chose a
 * path" from "never arrived". Returns whether the save succeeded — never
 * throws — so the caller can keep the student here with a retry rather than
 * walk them into a redirect loop. Exported for tests.
 */
export async function postWelcomeCompletion(
  path: WelcomePath,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn("/api/welcome/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface PathChoiceCardProps {
  choice: WelcomePathChoice;
  saving: boolean;
  hasError: boolean;
  onChoose: (choice: WelcomePathChoice) => void;
}

/**
 * One path card. It stays a real link — the href is what makes it
 * middle-clickable and readable to assistive tech — but the click is
 * intercepted so the completion fact lands before the navigation. A failed
 * save keeps the student here with a retry instead of dropping them into the
 * /dashboard ⇄ /welcome loop. Exported (named) so the failure markup is
 * directly testable via renderToString, mirroring QuickWinCard.
 */
export function PathChoiceCard({ choice, saving, hasError, onChoose }: PathChoiceCardProps) {
  return (
    <div>
      <Link
        href={choice.href}
        aria-busy={saving || undefined}
        onClick={(event) => {
          event.preventDefault();
          onChoose(choice);
        }}
        className={`group flex items-start gap-4 rounded-[1.5rem] border bg-[var(--surface-raised)] p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg ${
          hasError
            ? "border-[var(--badge-error-text)]"
            : choice.recommended
              ? "border-2 border-[var(--accent-strong)]"
              : "border-[var(--border)]"
        } ${saving ? "opacity-70" : ""}`}
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent-strong)] text-2xl text-white">
          {choice.icon}
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-lg font-semibold text-[var(--ink-strong)]">
              {choice.title}
            </p>
            {choice.recommended && (
              <span className="rounded-full bg-[var(--accent-strong)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--accent-strong)]">
                Recommended
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{choice.description}</p>
        </div>
      </Link>
      {hasError && (
        <p role="alert" className="mt-2 text-left text-xs font-medium text-[var(--badge-error-text)]">
          That didn&apos;t save. Tap to try again.
        </p>
      )}
    </div>
  );
}

interface QuickWinCardProps {
  item: QuickWinItemData;
  done: boolean;
  saving: boolean;
  hasError: boolean;
  onComplete: (itemId: string) => void;
}

/**
 * One quick-win row. A failed save must stay visible with a retry — it must
 * never disappear silently. Exported (named) so the failure-path markup is
 * directly testable via renderToString without simulating a click/fetch
 * cycle, mirroring the repo's OrientationWizard test pattern.
 */
export function QuickWinCard({ item, done, saving, hasError, onComplete }: QuickWinCardProps) {
  // Colors come from theme tokens, not hardcoded light values: the app themes
  // with [data-theme], while Tailwind's dark: variant keys off the OS setting,
  // so a `bg-green-50` card left white body text on pale green whenever the
  // two disagreed.
  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        done
          ? "border-[var(--border)] bg-[var(--badge-success-bg)]"
          : hasError
            ? "border-[var(--border)] bg-[var(--badge-error-bg)]"
            : "border-[var(--border)] bg-[var(--surface-raised)]"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--ink-strong)]">
            {done && <span className="mr-1.5">✓</span>}
            {item.label}
          </p>
          {item.description && (
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{item.description}</p>
          )}
        </div>
        {!done && (
          <button
            type="button"
            onClick={() => onComplete(item.id)}
            disabled={saving}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent-strong)] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent)] disabled:opacity-60"
          >
            {saving ? "Saving..." : hasError ? "Try again" : "I've read this"}
          </button>
        )}
      </div>
      {!done && hasError && (
        <p role="alert" className="mt-2 text-xs font-medium text-[var(--badge-error-text)]">
          That didn&apos;t save. Tap to try again.
        </p>
      )}
    </div>
  );
}

interface ScoreCardProps {
  /** Orientation items completed before this flow, plus wins from this flow. */
  completedCount: number;
  totalCount: number;
  /** Same value computeOrientationCompletionPercent returns — null when the
   *  real total is unavailable, so the caller falls back to count-free praise
   *  instead of a fabricated percentage. */
  percent: number | null;
}

/**
 * The "nice work" card shown once every quick win is done. Uses the honest
 * count framing — n of total real orientation items — instead of borrowing
 * the word "readiness" for a number that will not match the dashboard's
 * 100-point composite score. Exported (named) so the copy is directly
 * testable via renderToString, mirroring PathChoiceCard/QuickWinCard.
 *
 * It waits for an explicit Continue. A 2s auto-advance used to take the
 * message away mid-sentence for a slower reader — and this card is their only
 * confirmation that the first win actually saved.
 */
export function ScoreCard({ completedCount, totalCount, percent }: ScoreCardProps) {
  return (
    <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--badge-success-bg)] p-4">
      {percent !== null ? (
        <>
          <p className="text-sm font-medium text-[var(--ink-strong)]">
            🎉 Nice! You&apos;ve finished {completedCount} of {totalCount} orientation items.
          </p>
          <div
            role="progressbar"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={totalCount}
            aria-valuetext={`${completedCount} of ${totalCount} orientation items done`}
            className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"
          >
            <div
              className="h-full rounded-full bg-[var(--accent-green)] transition-all duration-1000"
              style={{ width: `${percent}%` }}
            />
          </div>
        </>
      ) : (
        <p className="text-sm font-medium text-[var(--ink-strong)]">
          🎉 Nice! You&apos;re off to a great start.
        </p>
      )}
    </div>
  );
}

interface ScoreSlotProps extends ScoreCardProps {
  /** False until every quick win is done — the card is present either way. */
  shown: boolean;
}

/**
 * Holds the score card's space from the moment step 2 renders.
 *
 * The card appears ABOVE the navigation the instant the last save resolves.
 * Inserting it at that moment pushed "← Back" down 57px (measured in a
 * browser at 375px) and dropped "Continue →" onto the pixel Back had just
 * vacated — so a student reaching for Back as the save landed hit the
 * opposite action. Keeping the card mounted all along and only revealing it
 * holds the row still. `invisible` is visibility:hidden, which also keeps the
 * unrevealed copy out of the accessibility tree, so nothing is announced
 * before it is true. Exported for tests.
 */
export function ScoreSlot({ shown, ...card }: ScoreSlotProps) {
  return (
    <div className={shown ? undefined : "invisible"}>
      <ScoreCard {...card} />
    </div>
  );
}

interface QuickWinsNavProps {
  hasQuickWins: boolean;
  allWinsDone: boolean;
  onAdvance: () => void;
  onBack: () => void;
}

/**
 * Step 2's navigation, rendered unconditionally — and that is the point.
 *
 * It used to be swapped out the moment the last quick-win save resolved, so a
 * student reaching for "Skip for now" during the round trip had the control
 * vanish from under their finger; a tap landing in the last frame hit a
 * detaching element. Now it stays mounted through the save and the score card
 * alike, so a tap always lands on a live control that does what the student
 * meant, and there is a way out at every instant.
 *
 * It deliberately does NOT go inert while a save is in flight: the POST has no
 * timeout, so disabling would leave a student on a stalled connection with no
 * working control anywhere on the step. Leaving mid-save is safe — the save
 * still records, and the advance it schedules is revocable (createAutoAdvance).
 * Exported (named) so these states are directly testable via renderToString,
 * mirroring ScoreCard and QuickWinCard.
 */
export function QuickWinsNav({ hasQuickWins, allWinsDone, onAdvance, onBack }: QuickWinsNavProps) {
  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      {/* Every variant carries the same 44px floor, so the row keeps its
          height when the label flips — otherwise "← Back" jumps the moment
          the save lands, which is the same hazard in a different costume. */}
      {hasQuickWins && !allWinsDone ? (
        <button
          onClick={onAdvance}
          className="inline-flex min-h-11 items-center justify-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
        >
          Skip for now →
        </button>
      ) : (
        <button
          onClick={onAdvance}
          className="primary-button inline-flex min-h-11 items-center justify-center px-8 py-3 text-sm"
        >
          {hasQuickWins ? "Continue →" : "Next →"}
        </button>
      )}
      <button
        onClick={onBack}
        className="inline-flex min-h-11 items-center justify-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
      >
        ← Back
      </button>
    </div>
  );
}

export default function WelcomeFlow({
  studentName,
  quickWinItems = [],
  totalOrientationItems,
  completedOrientationCount = 0,
}: WelcomeFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [completedWins, setCompletedWins] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [errorItemId, setErrorItemId] = useState<string | null>(null);
  const [showScore, setShowScore] = useState(false);
  const [savingPath, setSavingPath] = useState<WelcomePath | null>(null);
  const [errorPath, setErrorPath] = useState<WelcomePath | null>(null);

  const autoAdvance = useRef<AutoAdvance>(createAutoAdvance());
  useEffect(() => {
    const timer = autoAdvance.current;
    return () => timer.cancel();
  }, []);

  /**
   * Every manual navigation in this flow, and the one place the pending
   * auto-advance is revoked. Going through it uniformly is what stops the
   * celebration's timer from resurfacing steps later: skip mid-save, land on
   * the path chooser, tap back, and a still-armed timer would push forward
   * again from under the student.
   */
  function goToStep(nextStep: number) {
    autoAdvance.current.cancel();
    setStep(nextStep);
  }

  const hasQuickWins = quickWinItems.length > 0;
  const allWinsDone = hasQuickWins && completedWins.size >= quickWinItems.length;
  const completedOrientationTotal = completedOrientationCount + completedWins.size;
  const scorePct = computeOrientationCompletionPercent(
    totalOrientationItems,
    completedOrientationCount,
    completedWins.size,
  );

  async function completeQuickWin(itemId: string) {
    setSaving(itemId);
    setErrorItemId((prev) => (prev === itemId ? null : prev));
    const saved = await postQuickWinCompletion(itemId);
    setSaving(null);
    if (!saved) {
      setErrorItemId(itemId);
      return;
    }
    setCompletedWins((prev) => new Set(prev).add(itemId));
    if (completedWins.size + 1 >= quickWinItems.length) {
      setShowScore(true);
      autoAdvance.current.start(
        // The student can leave while the save is in flight — the navigation
        // stays live on purpose — so this schedules AFTER they may already be
        // somewhere else. Advance only from the step it was scheduled for.
        () => setStep((current) => (current === 2 ? 3 : current)),
        SCORE_ADVANCE_DELAY_MS,
      );
    }
  }

  async function choosePath(choice: WelcomePathChoice) {
    setSavingPath(choice.path);
    setErrorPath((prev) => (prev === choice.path ? null : prev));
    const saved = await postWelcomeCompletion(choice.path);
    setSavingPath(null);
    if (!saved) {
      // Navigating anyway would drop the student into the loop this fact
      // exists to prevent, so the failure stays on screen with a retry.
      setErrorPath(choice.path);
      return;
    }
    // refresh() before push(): the destination may already sit in the client
    // router cache from a prefetch taken BEFORE the completion fact existed —
    // and back then /dashboard answered with a redirect to /welcome. Serving
    // that cached answer would rebuild the loop out of stale bytes.
    router.refresh();
    router.push(choice.href);
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="text-center">
            <p className="mb-6 text-5xl">🌟</p>
            <h1 className="font-display text-3xl text-[var(--ink-strong)]">
              Welcome, {studentName}!
            </h1>
            <p className="mt-4 text-base leading-7 text-[var(--ink-muted)]">
              VisionQuest guides you through the SPOKES program. Set goals,
              earn certifications, and build your career.
            </p>
            <div className="mt-8 space-y-3 text-left">
              {[
                { icon: "📋", text: "Complete orientation forms and get set up for the program" },
                { icon: "🎯", text: "Set career goals and track your progress with AI coaching" },
                { icon: "🏆", text: "Earn industry certifications and build your professional portfolio" },
              ].map((item) => (
                <div key={item.text} className="flex items-start gap-3 rounded-xl bg-[var(--surface-raised)] p-3">
                  <span className="text-xl">{item.icon}</span>
                  <p className="text-sm text-[var(--ink-strong)]">{item.text}</p>
                </div>
              ))}
            </div>
            <button onClick={() => goToStep(1)} className="primary-button mt-8 px-8 py-3 text-sm">
              Let&apos;s get started →
            </button>
          </div>
        )}

        {/* Step 1: Meet Sage */}
        {step === 1 && (
          <div className="text-center">
            <p className="mb-6 text-5xl">🧙‍♂️</p>
            <h1 className="font-display text-3xl text-[var(--ink-strong)]">Meet Sage</h1>
            <p className="mt-4 text-base leading-7 text-[var(--ink-muted)]">
              Sage is your AI mentor, like a supportive friend. Sage helps you
              plan, stay motivated, and make progress toward your goals.
            </p>
            <div className="mt-8 space-y-3 text-left">
              {[
                { icon: "🎯", text: "Help you define your big dream and break it into steps" },
                { icon: "📋", text: "Guide you through orientation and paperwork" },
                { icon: "🔥", text: "Check in daily and celebrate your wins" },
                { icon: "❓", text: "Answer questions about certifications, platforms, and the program" },
              ].map((item) => (
                <div key={item.text} className="flex items-start gap-3 rounded-xl bg-[var(--surface-raised)] p-3">
                  <span className="text-xl">{item.icon}</span>
                  <p className="text-sm text-[var(--ink-strong)]">{item.text}</p>
                </div>
              ))}
            </div>
            <button onClick={() => goToStep(2)} className="primary-button mt-8 px-8 py-3 text-sm">
              Next →
            </button>
            <button
              onClick={() => goToStep(0)}
              className="mx-auto mt-3 flex min-h-11 items-center justify-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Step 2: Quick Wins */}
        {step === 2 && (
          <div className="text-center">
            <p className="mb-6 text-5xl">⚡</p>
            <h1 className="font-display text-3xl text-[var(--ink-strong)]">Your first wins</h1>
            <p className="mt-4 text-base leading-7 text-[var(--ink-muted)]">
              {hasQuickWins
                ? quickWinItems.length === 1
                  ? "Let's knock out this quick orientation item right now. It will take just a moment."
                  : "Let's knock out these quick orientation items right now. They will take just a moment."
                : "You're all set! Let's choose where you'd like to start."}
            </p>

            {hasQuickWins && (
              <div className="mt-8 space-y-3 text-left">
                {quickWinItems.map((item) => (
                  <QuickWinCard
                    key={item.id}
                    item={item}
                    done={completedWins.has(item.id)}
                    saving={saving === item.id}
                    hasError={errorItemId === item.id}
                    onComplete={completeQuickWin}
                  />
                ))}
              </div>
            )}

            {/* Score card after all wins — its space is held from the start
                so revealing it never moves the navigation below it. */}
            {hasQuickWins && (
              <ScoreSlot
                shown={showScore}
                completedCount={completedOrientationTotal}
                totalCount={totalOrientationItems}
                percent={scorePct}
              />
            )}

            <QuickWinsNav
              hasQuickWins={hasQuickWins}
              allWinsDone={allWinsDone}
              onAdvance={() => goToStep(3)}
              onBack={() => goToStep(1)}
            />
          </div>
        )}

        {/* Step 3: Choose your path */}
        {step === 3 && (
          <div className="text-center">
            <p className="mb-6 text-5xl">🚀</p>
            <h1 className="font-display text-3xl text-[var(--ink-strong)]">Your path to employment</h1>
            <p className="mt-4 text-base leading-7 text-[var(--ink-muted)]">
              VisionQuest is structured around one clear path to help you secure a job. Choose where you would like to start:
            </p>
            <div className="mt-8 space-y-3">
              {WELCOME_PATH_CHOICES.map((choice) => (
                <PathChoiceCard
                  key={choice.path}
                  choice={choice}
                  saving={savingPath === choice.path}
                  hasError={errorPath === choice.path}
                  onChoose={choosePath}
                />
              ))}
            </div>
            <button
              onClick={() => goToStep(2)}
              className="mt-4 flex min-h-11 items-center justify-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Step indicator dots */}
        <ol aria-label="Welcome progress" className="mt-8 flex items-center justify-center gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <li
              key={i}
              aria-current={i === step ? "step" : undefined}
              className={`h-2 rounded-full transition-all ${
                i === step
                  ? "w-6 bg-[var(--accent-strong)]"
                  : "w-2 bg-[var(--surface-muted)]"
              }`}
            >
              <span className="sr-only">Step {i + 1} of {TOTAL_STEPS}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
