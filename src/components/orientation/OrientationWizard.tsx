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
import WizardStepIndicator from "./WizardStepIndicator";
import WizardCompletion from "./WizardCompletion";

interface OrientationItem {
  id: string;
  label: string;
  description: string | null;
  section: string | null;
  required: boolean;
  completed: boolean;
}

type StepType = "sign" | "acknowledge" | "read-only" | "no-pdf" | "instructor-led";

interface WizardStep {
  orientationItemId: string;
  form?: SpokesForm;
  type: StepType;
  stepTitle: string;
  stepDescription: string | null;
  isLastForItem: boolean;
}

function classifyStep(form: SpokesForm): StepType {
  if (!hasDownloadableFormDocument(form)) return "no-pdf";
  if (form.requiresSignature) return "sign";
  if (form.acceptsSubmission) return "acknowledge";
  return "read-only";
}

function deriveSteps(items: OrientationItem[]): WizardStep[] {
  const steps: WizardStep[] = [];
  for (const item of items) {
    if (item.completed) continue;
    const detail = getOrientationStepDetail(item.label);
    if (detail.forms.length === 0) {
      steps.push({
        orientationItemId: item.id,
        type: "instructor-led",
        stepTitle: item.label,
        stepDescription: item.description || detail.note,
        isLastForItem: true,
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

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/orientation");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      const fetchedItems: OrientationItem[] = data.items || [];
      setItems(fetchedItems);

      const derivedSteps = deriveSteps(fetchedItems);
      if (derivedSteps.length === 0) {
        // All items already completed
        setAllAlreadyDone(true);
      }
      setSteps(derivedSteps);
    } catch {
      setError("Failed to load orientation. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function markItemComplete(itemId: string) {
    const res = await fetch("/api/orientation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, completed: true }),
    });
    if (!res.ok) {
      throw new Error("Failed to save progress");
    }
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
      if (step.isLastForItem) {
        await markItemComplete(step.orientationItemId);
      }
      advanceStep({ title: step.stepTitle, type: "signed" });
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
      if (step.isLastForItem) {
        await markItemComplete(step.orientationItemId);
      }
      const type = step.type === "acknowledge" ? "acknowledged" : "read";
      advanceStep({ title: step.stepTitle, type });
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkipNoPdf() {
    const step = steps[currentStep];
    if (!step) return;
    setSubmitting(true);
    try {
      if (step.isLastForItem) {
        await markItemComplete(step.orientationItemId);
      }
      advanceStep({ title: step.stepTitle, type: "read" });
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function advanceStep(completedForm: CompletedForm) {
    const newCompleted = [...completedForms, completedForm];
    setCompletedForms(newCompleted);
    setHasRead(false);
    setShowSignature(false);
    setError(null);

    if (currentStep + 1 >= steps.length) {
      // All done — fire completion
      completeOrientation(newCompleted);
    } else {
      setCurrentStep(currentStep + 1);
    }
  }

  async function completeOrientation(forms: CompletedForm[]) {
    try {
      await fetch("/api/orientation/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setTimeout(() => checkProgression(), 500);
    } catch {
      // Non-critical — XP may not display but completion is saved
    }
    setCompletedForms(forms);
    setCompleted(true);
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

  if (allAlreadyDone) {
    return (
      <WizardCompletion
        completedForms={items
          .filter((i) => i.completed)
          .map((i) => ({ title: i.label, type: "read" as const }))}
      />
    );
  }

  if (completed) {
    return <WizardCompletion completedForms={completedForms} />;
  }

  const step = steps[currentStep];
  if (!step) return null;

  const pdfUrl = step.form && hasDownloadableFormDocument(step.form)
    ? buildFormDownloadUrl(step.form, "view")
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <WizardStepIndicator
        totalSteps={steps.length}
        currentStep={currentStep}
        currentTitle={step.stepTitle}
      />

      {/* PDF Viewer / Instructor-led placeholder */}
      {step.type === "instructor-led" ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] py-16 gap-3">
          <p className="text-base font-medium text-[var(--ink-strong)]">{step.stepTitle}</p>
          {step.stepDescription && (
            <p className="text-sm text-[var(--ink-muted)] text-center max-w-md">{step.stepDescription}</p>
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

      {/* Action area */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5 space-y-4">
        {/* Mark Complete button (instructor-led type) */}
        {step.type === "instructor-led" && (
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={submitting}
            className="primary-button px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Mark Complete & Continue →"}
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

        {/* Skip button (no-pdf type) */}
        {step.type === "no-pdf" && (
          <button
            type="button"
            onClick={handleSkipNoPdf}
            disabled={submitting}
            className="primary-button px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Skip & Continue →"}
          </button>
        )}

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>
    </div>
  );
}
