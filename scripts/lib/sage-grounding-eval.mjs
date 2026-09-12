import { evaluateCareerAssertions } from "./sage-career-eval.mjs";

/** Extract document ids from actual download links, not title mentions. */
export function documentCitationIds(text) {
  return [...String(text ?? "").matchAll(/\/api\/documents\/download\?id=([^&\s)\]"<>]+)(?:&(?:amp;)?mode=view)?/g)]
    .map((match) => {
      try { return decodeURIComponent(match[1]); } catch { return match[1]; }
    });
}

/**
 * Checks explicit source links and prohibited claims in generated answers.
 * These deterministic checks complement review of the actual passages; they
 * do not claim to prove semantic entailment from a keyword or citation alone.
 * @param {{text: string, context?: string, calls?: string[], expectedDocumentIds?: string[], assert?: Record<string, any>}} input
 */
export function evaluateGroundingAssertions({ text, context = "", calls = [], expectedDocumentIds = [], assert = {} }) {
  const graded = evaluateCareerAssertions({ text, calls, assert });
  const normalized = String(text ?? "").replace(/[’‘]/g, "'").toLowerCase();
  if (assert.acknowledgementAny && !assert.acknowledgementAny.some((term) => normalized.includes(term.toLowerCase()))) {
    graded.failures.push("answer does not acknowledge its information or advice boundary");
  }
  const available = new Set(documentCitationIds(context));
  const cited = documentCitationIds(text);
  if (cited.some((id) => !available.has(id))) {
    graded.failures.push("answer cites a document that was not supplied in its context");
  }
  if (assert.mustCiteSource && !cited.some((id) => available.has(id) && expectedDocumentIds.includes(id))) {
    graded.failures.push("answer lacks a link to the expected supplied source");
  }
  return graded;
}

/**
 * Production present_form returns `Found "<title>"` plus a modelHint that
 * names the form. The grounding harness used a blank success stub, so a
 * "where can I find …" turn became "I've opened that" with none of the
 * fixture terms. Resolve the static catalog title the same way production
 * does for an exact id/title hit.
 *
 * @param {{ name?: string, args?: Record<string, unknown> }} call
 * @param {Array<{ id: string, title: string }>} forms
 */
export function groundingFormToolResult(call, forms) {
  const query = String(call?.args?.query ?? "").trim();
  const needle = query.toLowerCase();
  const match =
    forms.find((form) => form.id.toLowerCase() === needle || form.title.toLowerCase() === needle) ??
    forms.find(
      (form) =>
        needle.length > 0 &&
        (needle.includes(form.title.toLowerCase()) || form.title.toLowerCase().includes(needle)),
    );
  const title = match?.title ?? (query || "the form");
  return {
    response: {
      ok: true,
      title,
      formId: match?.id ?? null,
      modelHint: `Surfaced form "${title}". Briefly tell them what the form is for and any next step.`,
    },
    summary: `Found "${title}".`,
    status: "success",
  };
}

/** Every answer sample must pass; one unsafe reply cannot be majority-voted away. */
export async function runGroundingSamples(run, count) {
  if (!Number.isInteger(count) || count < 1 || count > 9) throw new Error("grounding samples must be 1–9");
  const samples = [];
  for (let i = 0; i < count; i++) samples.push({ sample: i + 1, ...await run() });
  const failed = samples.filter((sample) => !sample.pass);
  return {
    ...samples[0],
    pass: failed.length === 0,
    reason: failed.map((sample) => `sample ${sample.sample}: ${sample.reason}`).join("; ") || null,
    samples,
  };
}
