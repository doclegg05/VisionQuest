/**
 * Detect when a student commits to a form Sage just offered, and resolve
 * which catalog form to present via present_form (action card).
 *
 * Used by the chat send route so "Yes" / "let's do it" after a form offer
 * does not require the student to ask for the link again.
 */

import { FORMS, type SpokesForm } from "@/lib/spokes/forms";

/** Short affirmations / commitments that mean "go ahead with that form". */
const FORM_COMMITMENT_PATTERN =
  /^(yes|yeah|yep|yup|sure|ok|okay|k|alright|all right|sounds good|go ahead|do it|let'?s do it|lets do it|let'?s go|lets go|start|start it|all of them|all of it|both|the first one|first one)[!.,?]*$/i;

const FORM_ID_IN_URL =
  /\/api\/forms\/download\?[^)\s]*formId=([a-z0-9-]+)/gi;

/**
 * True when the user message is a short commitment to proceed with a form
 * already offered in the prior assistant turn.
 */
export function isFormCommitmentMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 48) return false;
  return FORM_COMMITMENT_PATTERN.test(trimmed);
}

/**
 * Extract catalog form ids referenced in assistant text — from download URLs
 * and from known form titles (order preserved, first wins for presentation).
 */
export function extractOfferedFormIds(assistantText: string): string[] {
  if (!assistantText.trim()) return [];

  const ids: string[] = [];
  const seen = new Set<string>();

  const push = (id: string) => {
    if (seen.has(id)) return;
    if (!FORMS.some((f) => f.id === id)) return;
    seen.add(id);
    ids.push(id);
  };

  for (const match of assistantText.matchAll(FORM_ID_IN_URL)) {
    push(match[1]);
  }

  const lower = assistantText.toLowerCase();
  // Longer titles first so "SPOKES Student Profile" wins over shorter overlaps.
  const byTitleLength = [...FORMS].sort(
    (a, b) => b.title.length - a.title.length,
  );
  for (const form of byTitleLength) {
    if (lower.includes(form.title.toLowerCase())) {
      push(form.id);
    }
  }

  return ids;
}

/**
 * If the student is affirming a form offer from the last assistant message,
 * return the first offered form (id + title). Otherwise null.
 */
export function resolveFormCommitment(
  userMessage: string,
  lastAssistantText: string | null | undefined,
): { formId: string; title: string; form: SpokesForm } | null {
  if (!isFormCommitmentMessage(userMessage)) return null;
  if (!lastAssistantText) return null;

  const offered = extractOfferedFormIds(lastAssistantText);
  if (offered.length === 0) return null;

  const form = FORMS.find((f) => f.id === offered[0]);
  if (!form) return null;

  return { formId: form.id, title: form.title, form };
}

/** Short assistant reply after a deterministic present_form on commitment. */
export function formCommitmentReply(title: string, morePending: boolean): string {
  if (morePending) {
    return `Here is your ${title}. Open it with the button below, fill it out, then tell me when you're done and we'll do the next one.`;
  }
  return `Here is your ${title}. Open it with the button below, fill it out, and tell me when you're done.`;
}
