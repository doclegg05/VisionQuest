import { FORMS } from "@/lib/spokes/forms";

export interface StudentStatusFormSubmission {
  formId: string;
  status: string;
  updatedAt: Date | string;
  reviewedAt?: Date | string | null;
  notes?: string | null;
}

export interface StudentStatusOrientationItem {
  id: string;
  label: string;
  required: boolean;
}

export interface StudentStatusOrientationProgress {
  itemId: string;
  completed: boolean;
  completedAt?: Date | string | null;
}

export interface StudentStatusFormItem {
  id: string;
  title: string;
  updatedAt: Date | string | null;
  reviewedAt: Date | string | null;
  notes: string | null;
}

export interface StudentStatusOrientationItemStatus {
  id: string;
  label: string;
}

export interface StudentStatusSignals {
  requiredForms: {
    total: number;
    approved: StudentStatusFormItem[];
    missing: StudentStatusFormItem[];
    pendingReview: StudentStatusFormItem[];
    needsRevision: StudentStatusFormItem[];
  };
  orientationChecklist: {
    totalRequired: number;
    completedRequired: number;
    incompleteRequired: StudentStatusOrientationItemStatus[];
  };
}

const REQUIRED_ONBOARDING_FORMS = FORMS
  .filter(
    (form) =>
      form.category === "onboarding" &&
      form.required &&
      form.acceptsSubmission &&
      (form.audience === "student" || form.audience === "both"),
  )
  .sort((left, right) => left.sortOrder - right.sortOrder);

function formatList(items: string[], limit: number = 4) {
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")}, and ${items.length - limit} more`;
}

export function buildStudentStatusSignals({
  formSubmissions,
  orientationItems,
  orientationProgress,
}: {
  formSubmissions: StudentStatusFormSubmission[];
  orientationItems: StudentStatusOrientationItem[];
  orientationProgress: StudentStatusOrientationProgress[];
}): StudentStatusSignals {
  const submissionByFormId = new Map(formSubmissions.map((submission) => [submission.formId, submission]));
  const progressByItemId = new Map(orientationProgress.map((progress) => [progress.itemId, progress]));

  const requiredForms = {
    total: REQUIRED_ONBOARDING_FORMS.length,
    approved: [] as StudentStatusFormItem[],
    missing: [] as StudentStatusFormItem[],
    pendingReview: [] as StudentStatusFormItem[],
    needsRevision: [] as StudentStatusFormItem[],
  };

  for (const form of REQUIRED_ONBOARDING_FORMS) {
    const submission = submissionByFormId.get(form.id);
    if (!submission) {
      requiredForms.missing.push({
        id: form.id,
        title: form.title,
        updatedAt: null,
        reviewedAt: null,
        notes: null,
      });
      continue;
    }

    const item: StudentStatusFormItem = {
      id: form.id,
      title: form.title,
      updatedAt: submission.updatedAt,
      reviewedAt: submission.reviewedAt ?? null,
      notes: submission.notes ?? null,
    };

    if (submission.status === "approved") {
      requiredForms.approved.push(item);
      continue;
    }

    if (submission.status === "rejected") {
      requiredForms.needsRevision.push(item);
      continue;
    }

    requiredForms.pendingReview.push(item);
  }

  const requiredOrientationItems = orientationItems.filter((item) => item.required);
  const incompleteRequired = requiredOrientationItems
    .filter((item) => !progressByItemId.get(item.id)?.completed)
    .map((item) => ({
      id: item.id,
      label: item.label,
    }));

  return {
    requiredForms,
    orientationChecklist: {
      totalRequired: requiredOrientationItems.length,
      completedRequired: requiredOrientationItems.length - incompleteRequired.length,
      incompleteRequired,
    },
  };
}

export function buildStudentStatusSummary(
  signals: StudentStatusSignals,
  options: { includePositiveSummary?: boolean } = {},
) {
  const lines: string[] = [];

  lines.push(
    `Required onboarding forms: ${signals.requiredForms.approved.length + signals.requiredForms.pendingReview.length + signals.requiredForms.needsRevision.length}/${signals.requiredForms.total} submitted or approved.`,
  );
  lines.push(
    `Required orientation checklist steps: ${signals.orientationChecklist.completedRequired}/${signals.orientationChecklist.totalRequired} complete.`,
  );

  if (signals.requiredForms.missing.length > 0) {
    lines.push(
      `Required onboarding forms still missing: ${formatList(signals.requiredForms.missing.map((item) => item.title))}.`,
    );
  }

  if (signals.requiredForms.pendingReview.length > 0) {
    lines.push(
      `Submitted forms awaiting instructor review: ${formatList(signals.requiredForms.pendingReview.map((item) => item.title))}.`,
    );
  }

  if (signals.requiredForms.needsRevision.length > 0) {
    lines.push(
      `Forms returned for revision: ${formatList(signals.requiredForms.needsRevision.map((item) => item.title))}.`,
    );
  }

  if (signals.orientationChecklist.incompleteRequired.length > 0) {
    lines.push(
      `Required orientation steps still incomplete: ${formatList(signals.orientationChecklist.incompleteRequired.map((item) => item.label))}.`,
    );
  }

  const hasOutstandingWork =
    signals.requiredForms.missing.length > 0 ||
    signals.requiredForms.pendingReview.length > 0 ||
    signals.requiredForms.needsRevision.length > 0 ||
    signals.orientationChecklist.incompleteRequired.length > 0;

  if (!hasOutstandingWork && !options.includePositiveSummary) {
    return null;
  }

  if (!hasOutstandingWork) {
    lines.push("All required onboarding forms are in and all required orientation steps are complete.");
  }

  return lines.join("\n");
}
