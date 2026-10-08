// =============================================================================
// SPOKES Form Search — hybrid (semantic + keyword) ranking
//
// Powers Sage's `search_forms` tool: given a natural-language request, return
// the best-matching program forms so Sage can recommend one and let the
// student verify it via a download link before acting.
//
// Ranking is hybrid:
//   - Semantic: embed the query and compare against cached form embeddings
//     (cosine == dot product, since embeddings.ts L2-normalizes). Handles
//     paraphrases like "the paper I sign to promise I'll attend".
//   - Keyword: synonym-expanded token overlap with a title-hit boost. Always
//     computed; it is the sole signal when the embedding API is unavailable.
//
// When embeddings succeed we blend the two; otherwise we fall back to keyword
// only. The 29-form catalog is embedded once per process and cached.
// =============================================================================

import { FORMS, FORM_CATEGORIES, canViewForm, hasDownloadableFormDocument } from "@/lib/spokes/forms";
import type { SpokesForm } from "@/lib/spokes/forms";
import { embedTextsWithModel } from "@/lib/ai/embeddings";
import { logger } from "@/lib/logger";
import { siblingScoreDelta } from "@/lib/spokes/form-sibling-rules";

// NOTE: the OKF catalog's curated notes (when-to-use / when-NOT-to-use) are
// deliberately NOT folded into this ranking index. Measurement showed adding
// them regressed top-1 12/12 -> 10/12: the form pipeline was already optimal,
// and "when NOT to use" text names sibling forms, which a keyword/vector
// matcher reads as plain tokens (it can't see the negation) and so matches
// THIS form to the sibling's queries more. Catalog notes are consumed at
// answer time instead — see src/lib/catalog/notes.ts, used by the
// search_forms tool's modelHint and the getDirectFormAnswer bypass.

export interface FormSearchCandidate {
  form: SpokesForm;
  /** Blended 0..1 relevance score. */
  score: number;
  /** Whether the form has a retrievable PDF the student can open. */
  available: boolean;
}

export interface FormSearchResult {
  candidates: FormSearchCandidate[];
  /** How the ranking was produced — surfaced for auditing/telemetry. */
  method: "hybrid" | "keyword";
}

// Blend weights when semantic scores are available. Semantic leads; keyword
// keeps exact title/keyword hits from being washed out by paraphrase.
const SEMANTIC_WEIGHT = 0.65;
const KEYWORD_WEIGHT = 0.35;
// Floor below which a candidate is too weak to surface.
const SCORE_FLOOR = 0.12;
const DEFAULT_LIMIT = 3;

// Lightweight synonym expansion so loose phrasing reaches the right titles.
// Keys and values are matched/added as lowercase tokens.
const SYNONYMS: Record<string, string[]> = {
  sign: ["signature", "signed", "agreement", "contract"],
  signature: ["sign", "signed"],
  attend: ["attendance", "present", "showup"],
  attendance: ["attend", "absence", "tardy"],
  show: ["attendance", "attend"],
  job: ["employment", "work", "career"],
  resume: ["portfolio", "employment"],
  welcome: ["onboarding", "orientation", "intro"],
  start: ["onboarding", "enrollment", "intake"],
  enroll: ["enrollment", "intake", "onboarding"],
  benefits: ["dohs", "tanf", "snap", "works"],
  cert: ["certification", "credential"],
  certificate: ["certification", "credential"],
  dress: ["code", "appearance"],
  pay: ["stipend", "reimbursement", "mileage"],
};

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function expand(tokens: string[]): Set<string> {
  const out = new Set<string>(tokens);
  for (const token of tokens) {
    const extra = SYNONYMS[token];
    if (extra) for (const e of extra) out.add(e);
  }
  return out;
}

function embeddingTextFor(form: SpokesForm): string {
  const categoryLabel = FORM_CATEGORIES[form.category]?.label ?? form.category;
  return `${form.title}. ${form.description}. Category: ${categoryLabel}.`;
}

/**
 * Keyword relevance in [0,1]. Synonym-expanded query tokens scored against the
 * form's title + description + category + filename, with a boost when query
 * terms hit the title directly.
 */
export function keywordScore(query: string, form: SpokesForm): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const expanded = expand(queryTokens);

  const categoryLabel = FORM_CATEGORIES[form.category]?.label ?? form.category;
  const titleTokens = new Set(tokenize(form.title));

  const bodyTokens = new Set(
    tokenize(`${form.title} ${form.description} ${categoryLabel} ${form.fileName}`),
  );

  let overlap = 0;
  let titleHits = 0;
  for (const token of expanded) {
    if (bodyTokens.has(token)) overlap += 1;
    if (titleTokens.has(token)) titleHits += 1;
  }

  const base = overlap / expanded.size;
  const titleBoost = titleHits > 0 ? 0.2 * (titleHits / queryTokens.length) : 0;
  return Math.min(1, base + titleBoost);
}

// ---- Cache is keyed by the model that actually generated the query. ----
const formEmbeddingCache = new Map<string, Promise<Map<string, number[]> | null>>();

async function getFormEmbeddings(queryModel: string): Promise<Map<string, number[]> | null> {
  const cached = formEmbeddingCache.get(queryModel);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const { vectors, model } = await embedTextsWithModel(
        FORMS.map(embeddingTextFor),
        { taskType: "RETRIEVAL_DOCUMENT", usage: { callSite: "sage_form_search_index" } },
      );
      if (model !== queryModel) throw new Error("Embedding model changed during form indexing");
      return new Map(FORMS.map((form, i) => [form.id, vectors[i]]));
    } catch (error) {
      formEmbeddingCache.delete(queryModel);
      logger.warn("Form embedding index unavailable; keyword-only search", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();
  // Retain only the current generation, including its in-flight initialization.
  formEmbeddingCache.clear();
  formEmbeddingCache.set(queryModel, pending);
  return pending;
}

/** Cosine similarity for already-L2-normalized vectors == dot product. */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Rank role-visible forms against a natural-language query. Hybrid when the
 * embedding API is reachable, keyword-only otherwise.
 */
export async function searchForms(params: {
  query: string;
  role: string;
  limit?: number;
  /**
   * The student whose query this is, for LlmCallLog / AI-audit attribution of
   * the query embedding (FERPA review W5). Null or absent for staff callers.
   */
  studentId?: string | null;
}): Promise<FormSearchResult> {
  const query = params.query.trim();
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), 8);
  const visible = FORMS.filter((form) => canViewForm(form, params.role));
  if (!query || visible.length === 0) {
    return { candidates: [], method: "keyword" };
  }

  const keyword = new Map<string, number>();
  for (const form of visible) keyword.set(form.id, keywordScore(query, form));

  let semantic: Map<string, number> | null = null;
  try {
    const { vectors: [queryVec], model } = await embedTextsWithModel([query], {
      taskType: "RETRIEVAL_QUERY",
      usage: {
        callSite: "sage_form_search_query",
        studentId: params.studentId ?? null,
        sensitivity: params.studentId ? "student_record" : "staff_entered",
      },
    });
    const formEmbeddings = await getFormEmbeddings(model);
    if (formEmbeddings) {
      semantic = new Map<string, number>();
      for (const form of visible) {
        const vec = formEmbeddings.get(form.id);
        semantic.set(form.id, vec ? Math.max(0, dot(queryVec, vec)) : 0);
      }
    }
  } catch (error) {
    logger.warn("Form query embedding failed; keyword-only ranking", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const method: FormSearchResult["method"] = semantic ? "hybrid" : "keyword";
  const ranked = visible
    .map((form) => {
      const kw = keyword.get(form.id) ?? 0;
      const base = semantic
        ? SEMANTIC_WEIGHT * (semantic.get(form.id) ?? 0) + KEYWORD_WEIGHT * kw
        : kw;
      const score = Math.max(0, base + siblingScoreDelta(query, form.id));
      return { form, score, available: hasDownloadableFormDocument(form) };
    })
    .filter((c) => c.score >= SCORE_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { candidates: ranked, method };
}

/** Test seam: reset the in-process embedding cache. */
export function __resetFormEmbeddingCache(): void {
  formEmbeddingCache.clear();
}
