"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AnswerOption {
  value: number;
  name: string;
}

interface Question {
  index: number;
  area: string;
  text: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; questions: Question[]; answerOptions: AnswerOption[] }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

const DEFAULT_OPTIONS: AnswerOption[] = [
  { value: 1, name: "Strongly Dislike" },
  { value: 2, name: "Dislike" },
  { value: 3, name: "Unsure" },
  { value: 4, name: "Like" },
  { value: 5, name: "Strongly Like" },
];

/**
 * In-app O*NET Mini Interest Profiler (30 questions).
 */
export function InterestProfilerWizard() {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [cursor, setCursor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/career/interest-profiler/questions");
        const data = (await res.json()) as {
          configured?: boolean;
          questions?: Question[];
          answerOptions?: AnswerOption[];
          message?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.questions?.length) {
          setLoad({
            status: res.status === 503 ? "unavailable" : "error",
            message:
              data.message ||
              "Interest Profiler questions are unavailable right now.",
          });
          return;
        }
        setLoad({
          status: "ready",
          questions: data.questions,
          answerOptions:
            data.answerOptions && data.answerOptions.length > 0
              ? data.answerOptions
              : DEFAULT_OPTIONS,
        });
      } catch {
        if (!cancelled) {
          setLoad({
            status: "error",
            message: "Could not reach the Interest Profiler. Check your connection.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const questions = load.status === "ready" ? load.questions : [];
  const options = load.status === "ready" ? load.answerOptions : DEFAULT_OPTIONS;
  const current = questions[cursor];
  const answeredCount = useMemo(
    () => questions.filter((q) => answers[q.index] != null).length,
    [answers, questions],
  );
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  const selectAnswer = useCallback(
    (value: number) => {
      if (!current) return;
      setAnswers((prev) => ({ ...prev, [current.index]: value }));
      setSubmitError(null);
      if (cursor < questions.length - 1) {
        setCursor((c) => c + 1);
      }
    },
    [current, cursor, questions.length],
  );

  async function submit() {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const ordered = questions
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((q) => String(answers[q.index]))
      .join("");
    try {
      const res = await fetch("/api/career/interest-profiler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "onet", answers: ordered }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; profilePath?: string };
      if (!res.ok || !data.ok) {
        setSubmitError(data.message || "Could not save your results. Try again.");
        setSubmitting(false);
        return;
      }
      router.push(data.profilePath || "/career/profile");
      router.refresh();
    } catch {
      setSubmitError("Network error while saving. Try again.");
      setSubmitting(false);
    }
  }

  if (load.status === "loading") {
    return (
      <p className="text-sm text-[var(--ink-muted)]" role="status">
        Loading Interest Profiler questions…
      </p>
    );
  }

  if (load.status === "unavailable" || load.status === "error") {
    return (
      <section className="surface-section space-y-4 p-5 sm:p-6">
        <p className="text-sm leading-6 text-[var(--ink-muted)]">{load.message}</p>
        <Link
          href="/career/interest-profiler/import"
          prefetch={false}
          className="primary-button inline-flex px-5 py-3 text-sm"
        >
          Import scores instead
        </Link>
      </section>
    );
  }

  const progressPct = Math.round((answeredCount / questions.length) * 100);

  return (
    <section className="surface-section space-y-5 p-5 sm:p-6" aria-labelledby="ip-wizard-heading">
      <div>
        <h2 id="ip-wizard-heading" className="font-display text-xl font-bold text-[var(--ink-strong)]">
          Question {cursor + 1} of {questions.length}
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          How would you feel about doing this kind of work?
        </p>
        <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
          <div
            className="h-full rounded-full bg-[var(--accent-strong)]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {current && (
        <div>
          <p className="text-lg font-semibold text-[var(--ink-strong)]">{current.text}</p>
          <fieldset className="mt-4 space-y-2">
            <legend className="sr-only">Answer options</legend>
            {options.map((opt) => {
              const selected = answers[current.index] === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => selectAnswer(opt.value)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition ${
                    selected
                      ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] font-semibold text-[var(--ink-strong)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--accent-strong)]"
                  }`}
                >
                  <span>{opt.name}</span>
                  <span className="text-xs text-[var(--ink-muted)]">{opt.value}</span>
                </button>
              );
            })}
          </fieldset>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="secondary-button px-4 py-3 text-sm"
          disabled={cursor === 0}
          onClick={() => setCursor((c) => Math.max(0, c - 1))}
        >
          Back
        </button>
        <button
          type="button"
          className="secondary-button px-4 py-3 text-sm"
          disabled={cursor >= questions.length - 1}
          onClick={() => setCursor((c) => Math.min(questions.length - 1, c + 1))}
        >
          Skip ahead
        </button>
        <button
          type="button"
          className="primary-button px-5 py-3 text-sm"
          disabled={!allAnswered || submitting}
          onClick={() => void submit()}
        >
          {submitting ? "Saving…" : "See my results"}
        </button>
      </div>

      {submitError && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {submitError}
        </p>
      )}

      <p className="text-xs leading-5 text-[var(--ink-muted)]">
        This assessment uses the O*NET® Interest Profiler™ Mini-IP via{" "}
        <a
          href="https://services.onetcenter.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          O*NET Web Services
        </a>
        .{" "}
        <Link href="/career/interest-profiler/import" prefetch={false} className="underline">
          Already have scores? Import them
        </Link>
        . Public interest-area info (no login):{" "}
        <Link href="/onet-interest-areas" prefetch={false} className="underline">
          /onet-interest-areas
        </Link>
        .
      </p>
    </section>
  );
}
