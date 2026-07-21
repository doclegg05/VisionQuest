"use client";

import { useState, useEffect, useCallback } from "react";
import { useProgression } from "@/components/progression/ProgressionProvider";
import { getOrientationStepDetail } from "@/lib/orientation-step-resources";
import {
  buildFormDownloadUrl,
  hasDownloadableFormDocument,
  type SpokesForm,
} from "@/lib/spokes/forms";
import SignaturePad from "@/components/ui/SignaturePad";
import StudentProfileFormStep from "./StudentProfileFormStep";
import WizardStepIndicator from "./WizardStepIndicator";
import WizardCompletion from "./WizardCompletion";

interface OrientationItem {
  id: string;
  label: string;
  description: string | null;
  section: string | null;
  required: boolean;
  completed: boolean;
  verificationStatus: string | null;
}

type StepType = "sign" | "acknowledge" | "read-only" | "no-pdf" | "instructor-led" | "profile-form";

interface WizardStep {
  orientationItemId: string;
  form?: SpokesForm;
  type: StepType;
  stepTitle: string;
  stepDescription: string | null;
  isLastForItem: boolean;
  /** The instructor declined this item's earlier claim — student redoes it. */
  needsRedo?: boolean;
}

function classifyStep(form: SpokesForm): StepType {
  // The Student Profile is completed as an in-browser form that writes the
  // student's SpokesRecord — not read as a PDF (2026-07-13; the PDF stays
  // available from the Documents page and the instructor print packet).
  if (form.id === "student-profile") return "profile-form";
  if (!hasDownloadableFormDocument(form)) return "no-pdf";
  if (form.requiresSignature) return "sign";
  if (form.acceptsSubmission) return "acknowledge";
  return "read-only";
}

async function fetchOrientationWizardItems(): Promise<OrientationItem[]> {
  const res = await fetch("/api/orientation");
  if (!res.ok) throw new Error("Failed to load");
  const data = await res.json();
  return data.items || [];
}

/**
 * Posts the idempotent orientation-completion sync and reports whether it
 * saved. Never throws — a network failure reads the same as a non-2xx
 * response so callers can offer a retry. Exported for tests.
 */
export async function postOrientationCompletion(
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetchFn("/api/orientation/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function deriveSteps(items: OrientationItem[]): WizardStep[] {
  const steps: WizardStep[] = [];
  for (const item of items) {
    // Pending-verification items were already claimed by the student and are
    // waiting on the instructor — no step to redo, and never a blocker.
    if (item.completed || item.verificationStatus === "pending") continue;
    const needsRedo = item.verificationStatus === "declined";
    const detail = getOrientationStepDetail(item.label);
    if (detail.forms.length === 0) {
      steps.push({
        orientationItemId: item.id,
        type: "instructor-led",
        stepTitle: item.label,
        stepDescription: item.description || detail.note,
        isLastForItem: true,
        needsRedo,
      });
      continue;
    }
    const formSteps: WizardStep[] = [];
    for (const form of detail.forms) {
      formSteps.push({
        orientationItemId: item.id,
        form,
        type: classifyStep(form),
        stepTitle: form.title,
        stepDescription: form.description,
        isLastForItem: false,
        needsRedo,
      });
    }
    if (formSteps.length > 0) {
      formSteps[formSteps.length - 1].isLastForItem = true;
    }
    steps.push(...formSteps);
  }
  return steps;
}

interface CompletedForm {
  title: string;
  type: "signed" | "acknowledged" | "read";
}

export default function OrientationWizard() {
  const { checkProgression } = useProgression();
  const [items, setItems] = useState<OrientationItem[]>([]);
  const [steps, setSteps] = useState<WizardStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasRead, setHasRead] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completedForms, setCompletedForms] = useState<CompletedForm[]>([]);
  const [allAlreadyDone, setAllAlreadyDone] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Items claimed done and waiting on instructor verification (P1-1) —
  // seeded from the server, grown as the student marks honor-system steps.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // Non-null once every remaining step is finished but N items still await
  // instructor verification — renders the "Almost there" end state.
  const [awaitingCount, setAwaitingCount] = useState<number | null>(null);
  // Transient "✓ sent" notice shown after an honor-system step is marked.
  const [justSentTitle, setJustSentTitle] = useState<string | null>(null);

  // Shared completion sync — used by the normal wizard-finish path and by the
  // all-already-done path so the progression flag can never be left behind.
  const syncCompletion = useCallback(async () => {
    setSyncing(true);
    setSyncError(false);
    const saved = await postOrientationCompletion();
    setSyncing(false);
    if (saved) {
      // Give the server a moment to award XP before refreshing progression.
      setTimeout(() => checkProgression(), 500);
    } else {
      // The completion flag did NOT save. Per-item progress is already
      // stored, so don't block the student — surface a retry notice instead.
      setSyncError(true);
    }
  }, [checkProgression]);

  // If every item was finished in a prior session, the completion flag may
  // still be unset (the original sync call could have failed). The server
  // route is idempotent, so re-run the sync whenever this state is detected.
  useEffect(() => {
    if (!allAlreadyDone) return;
    void syncCompletion();
  }, [allAlreadyDone, syncCompletion]);

  // Shared by initial load and retry: seeds items, pending-verification
  // state, derived steps, and the correct empty-steps end state.
  const applyFetchedItems = useCallback((fetchedItems: OrientationItem[]) => {
    setItems(fetchedItems);

    const pending = fetchedItems.filter(
      (item) => !item.completed && item.verificationStatus === "pending",
    );
    setPendingIds(new Set(pending.map((item) => item.id)));

    const derivedSteps = deriveSteps(fetchedItems);
    if (derivedSteps.length === 0) {
      if (pending.length > 0) {
        // Nothing left for the student — the instructor still has to verify.
        setAwaitingCount(pending.length);
      } else {
        // All items already completed
        setAllAlreadyDone(true);
      }
    }
    setSteps(derivedSteps);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const fetchedItems = await fetchOrientationWizardItems();
      applyFetchedItems(fetchedItems);
    } catch {
      setError("Failed to load orientation. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [applyFetchedItems]);

  useEffect(() => {
    let cancelled = false;
    fetchOrientationWizardItems()
      .then((fetchedItems) => {
        if (cancelled) return;
        applyFetchedItems(fetchedItems);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load orientation. Please refresh.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyFetchedItems]);

  async function markItemComplete(itemId: string): Promise<{ pendingVerification: boolean }> {
    const res = await fetch("/api/orientation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, completed: true }),
    });
    if (!res.ok) {
      throw new Error("Failed to save progress");
    }
    const body = (await res.json().catch(() => ({}))) as {
      data?: { pendingVerification?: boolean };
    };
    return { pendingVerification: Boolean(body?.data?.pendingVerification) };
  }

  /**
   * Finish the current step: mark the item complete when this is its last
   * step, record pending-verification claims, and advance. Never blocks —
   * honor-system steps advance immediately with a "✓ sent" notice.
   */
  async function finishStep(step: WizardStep, completedForm: CompletedForm) {
    setJustSentTitle(null);
    let pendingCount = pendingIds.size;
    let form: CompletedForm | null = completedForm;

    if (step.isLastForItem) {
      const { pendingVerification } = await markItemComplete(step.orientationItemId);
      if (pendingVerification) {
        const nextPending = new Set(pendingIds).add(step.orientationItemId);
        setPendingIds(nextPending);
        pendingCount = nextPending.size;
        form = null;
        setJustSentTitle(step.stepTitle);
      }
    }
    advanceStep(form, pendingCount);
  }

  async function handleSign(dataUrl: string) {
    const step = steps[currentStep];
    if (!step) return;
    setSubmitting(true);
    setError(null);
    try {
      const signRes = await fetch("/api/forms/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId: step.form!.id, signature: dataUrl }),
      });
      if (!signRes.ok) {
        const data = await signRes.json().catch(() => ({}));
        setError(data.error || "Signature submission failed.");
        return;
      }
      await finishStep(step, { title: step.stepTitle, type: "signed" });
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAcknowledge() {
    const step = steps[currentStep];
    if (!step) return;
    setSubmitting(true);
    setError(null);
    try {
      const type = step.type === "acknowledge" ? "acknowledged" : "read";
      await finishStep(step, { title: step.stepTitle, type });
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProfileSaved() {
    const step = steps[currentStep];
    if (!step) return;
    // The profile itself is already saved by the form component; here we
    // only record orientation progress and advance.
    await finishStep(step, { title: step.stepTitle, type: "acknowledged" });
  }

  async function handleSkipNoPdf() {
    const step = steps[currentStep];
    if (!step) return;
    setSubmitting(true);
    try {
      await finishStep(step, { title: step.stepTitle, type: "read" });
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function advanceStep(completedForm: CompletedForm | null, pendingCount: number) {
    const newCompleted = completedForm ? [...completedForms, completedForm] : completedForms;
    setCompletedForms(newCompleted);
    setHasRead(false);
    setShowSignature(false);
    setError(null);

    if (currentStep + 1 >= steps.length) {
      if (pendingCount > 0) {
        // Every remaining item is waiting on instructor verification — show
        // the "Almost there" end state instead of the completion celebration.
        setAwaitingCount(pendingCount);
      } else {
        // All done — fire completion
        completeOrientation(newCompleted);
      }
    } else {
      setCurrentStep(currentStep + 1);
    }
  }

  function completeOrientation(forms: CompletedForm[]) {
    // The student finished every step — show the completion screen right
    // away and run the sync in the background. If the sync fails the shared
    // handler shows a non-blocking retry notice on the completion screen.
    setCompletedForms(forms);
    setCompleted(true);
    void syncCompletion();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-[var(--ink-faint)]">Loading orientation...</p>
      </div>
    );
  }

  if (error && steps.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          type="button"
          onClick={() => { setError(null); setLoading(true); void fetchData(); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  const syncNotice = syncError ? (
    <div
      role="alert"
      className="mx-auto mb-6 flex max-w-xl flex-wrap items-center justify-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <p className="text-sm text-amber-800">
        We couldn&apos;t save your completion — your progress is safe.
      </p>
      <button
        type="button"
        onClick={() => void syncCompletion()}
        disabled={syncing}
        className="min-h-11 rounded-lg border border-amber-400 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {syncing ? "Saving..." : "Try again"}
      </button>
    </div>
  ) : null;

  if (allAlreadyDone) {
    return (
      <div>
        {syncNotice}
        <WizardCompletion
          completedForms={items
            .filter((i) => i.completed)
            .map((i) => ({ title: i.label, type: "read" as const }))}
        />
      </div>
    );
  }

  if (awaitingCount !== null) {
    return (
      <div className="mx-auto max-w-xl text-center py-10">
        <div className="text-5xl mb-4">⏳</div>
        <h2 className="font-display text-2xl font-bold text-[var(--ink-strong)]">
          Almost there!
        </h2>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          You&apos;ve done your part — your instructor is verifying{" "}
          <span className="font-semibold text-[var(--ink-strong)]">
            {awaitingCount} {awaitingCount === 1 ? "step" : "steps"}
          </span>
          . You&apos;ll be marked Onboarded as soon as they confirm.
        </p>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-2">
            Waiting on your instructor
          </p>
          <div className="space-y-1.5">
            {items
              .filter((item) => pendingIds.has(item.id))
              .map((item) => (
                <p key={item.id} className="flex items-center gap-2 text-sm text-amber-800">
                  <span aria-hidden>✓</span>
                  <span className="truncate">{item.label}</span>
                  <span className="ml-auto shrink-0 text-xs text-amber-600">sent</span>
                </p>
              ))}
          </div>
        </div>
        <p className="mt-4 text-xs text-[var(--ink-faint)]">
          No need to wait here — keep exploring VisionQuest and check back later.
        </p>
      </div>
    );
  }

  if (completed) {
    return (
      <div>
        {syncNotice}
        <WizardCompletion completedForms={completedForms} />
      </div>
    );
  }

  const step = steps[currentStep];
  if (!step) return null;

  const pdfUrl = step.form && hasDownloadableFormDocument(step.form)
    ? buildFormDownloadUrl(step.form, "view")
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {justSentTitle && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3"
        >
          <span className="text-emerald-600" aria-hidden>✓</span>
          <p className="text-sm text-emerald-800">
            Sent — your instructor will verify &ldquo;{justSentTitle}&rdquo;.
          </p>
        </div>
      )}

      <WizardStepIndicator
        totalSteps={steps.length}
        currentStep={currentStep}
        currentTitle={step.stepTitle}
      />

      {/* PDF Viewer / in-browser form / instructor-led placeholder */}
      {step.type === "profile-form" ? (
        <StudentProfileFormStep onComplete={handleProfileSaved} />
      ) : step.type === "instructor-led" ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] py-16 gap-3">
          <p className="text-base font-medium text-[var(--ink-strong)]">{step.stepTitle}</p>
          {step.stepDescription && (
            <p className="text-sm text-[var(--ink-muted)] text-center max-w-md">{step.stepDescription}</p>
          )}
          {step.needsRedo && (
            <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
              Your instructor asked you to redo this step.
            </p>
          )}
          <p className="mt-2 text-xs text-[var(--ink-faint)]">
            Your instructor will lead this step.
          </p>
        </div>
      ) : step.type === "no-pdf" ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] py-16">
          <p className="text-sm text-[var(--ink-muted)]">
            This form is not yet available digitally.
          </p>
          <p className="mt-1 text-xs text-[var(--ink-faint)]">
            Your instructor will provide a paper copy.
          </p>
          {step.needsRedo && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
              Your instructor asked you to redo this step.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <iframe
            key={step.form!.id}
            src={pdfUrl!}
            title={step.form!.title}
            className="h-[500px] w-full border-0 bg-[var(--surface-raised)]"
          />
        </div>
      )}

      {/* Action area (the profile form carries its own submit button) */}
      {step.type !== "profile-form" && (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5 space-y-4">
        {/* Mark-done button (instructor-led type) — records a pending
            verification claim; the instructor confirms it later. */}
        {step.type === "instructor-led" && (
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={submitting}
            className="primary-button px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Sending..." : "Mark done — your instructor will verify"}
          </button>
        )}

        {/* Read checkbox (for sign and acknowledge types) */}
        {(step.type === "sign" || step.type === "acknowledge") && (
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={hasRead}
              onChange={(e) => setHasRead(e.target.checked)}
              className="h-5 w-5 rounded border-[var(--border-strong)] text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm text-[var(--ink-strong)]">
              I have read this document
            </span>
          </label>
        )}

        {/* Signature area (sign type only) */}
        {step.type === "sign" && hasRead && (
          showSignature ? (
            <div>
              {submitting && (
                <p className="mb-2 text-xs text-[var(--ink-muted)]">Submitting...</p>
              )}
              <SignaturePad
                onSign={handleSign}
                onCancel={() => setShowSignature(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSignature(true)}
              className="primary-button px-6 py-2.5 text-sm"
            >
              Sign & Continue →
            </button>
          )
        )}

        {/* Continue button (acknowledge type) */}
        {step.type === "acknowledge" && (
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={!hasRead || submitting}
            className="primary-button px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Continue →"}
          </button>
        )}

        {/* Continue button (read-only type) */}
        {step.type === "read-only" && (
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={submitting}
            className="primary-button px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Continue →"}
          </button>
        )}

        {/* Skip / mark-done button (no-pdf type). When this paper step is the
            item's last step, marking it files a pending verification claim. */}
        {step.type === "no-pdf" && (
          <button
            type="button"
            onClick={handleSkipNoPdf}
            disabled={submitting}
            className="primary-button px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? step.isLastForItem ? "Sending..." : "Saving..."
              : step.isLastForItem
                ? "Mark done — your instructor will verify"
                : "Skip & Continue →"}
          </button>
        )}

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>
      )}
    </div>
  );
}
