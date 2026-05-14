/**
 * Document-based context from ProgramDocument (dynamic RAG layer).
 *
 * Server-only because it touches Prisma and the cache layer. Split out
 * of `./knowledge-base` so client components that pull pure helpers
 * (e.g. `getRelevantContent`, `SPOKES_BRIEF`) via system-prompts don't
 * drag `node:async_hooks` (via the RLS Prisma extension) into the
 * browser bundle.
 */

import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";

interface SageDocument {
  id: string;
  title: string;
  sageContextNote: string | null;
  certificationId: string | null;
  platformId: string | null;
  audience: string;
}

type CallerRole = "student" | "staff";

function isSageRagEnabled(): boolean {
  const value = process.env.SAGE_RAG_ENABLED;
  if (!value) return true;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

const GENERIC_RETRIEVAL_WORDS = new Set([
  "about",
  "category",
  "certificate",
  "certificates",
  "certification",
  "complete",
  "document",
  "documents",
  "file",
  "fillable",
  "form",
  "forms",
  "guide",
  "guides",
  "information",
  "need",
  "needs",
  "platform",
  "program",
  "related",
  "required",
  "student",
  "students",
  "submit",
  "used",
  "uses",
  "using",
  "work",
]);

function tokenizeForRetrieval(text: string, minLength: number): string[] {
  return (
    text
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((word) => word.length >= minLength && !GENERIC_RETRIEVAL_WORDS.has(word)) ?? []
  );
}

function messageIncludesIdentifier(messageLower: string, identifier: string): boolean {
  const normalizedIdentifier = identifier.toLowerCase().replace(/[-_]+/g, " ");
  const normalizedMessage = messageLower.replace(/[-_]+/g, " ");
  return (
    messageLower.includes(identifier.toLowerCase()) ||
    normalizedMessage.includes(normalizedIdentifier)
  );
}

async function loadSageDocuments(callerRole: CallerRole): Promise<SageDocument[]> {
  const cacheKey = `sage:documents:${callerRole}`;
  // Filter by audience: students only see STUDENT + BOTH; staff see all
  return cached(cacheKey, 300, () =>
    prisma.programDocument.findMany({
      where: {
        usedBySage: true,
        isActive: true,
        ...(callerRole === "student"
          ? { audience: { not: "TEACHER" } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        sageContextNote: true,
        certificationId: true,
        platformId: true,
        audience: true,
      },
    }),
  );
}

interface SageSnippetRow {
  question: string;
  answer: string;
  keywords: string[];
}

async function loadSageSnippets(): Promise<SageSnippetRow[]> {
  return cached("sage:snippets", 300, () =>
    prisma.sageSnippet.findMany({
      where: { isActive: true },
      select: { question: true, answer: true, keywords: true },
    }),
  );
}

/**
 * Score a document against the user message using keyword matching
 * on title, certificationId, platformId, and sageContextNote.
 */
function scoreDocument(doc: SageDocument, messageLower: string): number {
  let score = 0;

  // Match title words (each word matched adds its length)
  const titleWords = tokenizeForRetrieval(doc.title, 3);
  for (const word of titleWords) {
    if (messageLower.includes(word)) {
      score += word.length;
    }
  }

  // Match certificationId and platformId directly
  if (doc.certificationId && messageIncludesIdentifier(messageLower, doc.certificationId)) {
    score += doc.certificationId.length * 2; // higher weight for exact ID match
  }
  if (doc.platformId && messageIncludesIdentifier(messageLower, doc.platformId)) {
    score += doc.platformId.length * 2;
  }

  // Match keywords in sageContextNote (first 500 chars for better recall)
  if (doc.sageContextNote) {
    const noteWords = tokenizeForRetrieval(doc.sageContextNote.slice(0, 500), 4);
    for (const word of noteWords) {
      if (messageLower.includes(word)) {
        score += 1; // lower weight for note matches
      }
    }
  }

  return score;
}

function scoreSnippet(snippet: SageSnippetRow, messageLower: string): number {
  let score = 0;

  // Keyword matches: each match scores its length
  for (const keyword of snippet.keywords) {
    if (keyword.length > 0 && messageLower.includes(keyword.toLowerCase())) {
      score += keyword.length;
    }
  }

  // Question word matches: 2x weight
  const questionWords = snippet.question.toLowerCase().split(/\s+/);
  for (const word of questionWords) {
    if (word.length >= 3 && messageLower.includes(word)) {
      score += word.length * 2;
    }
  }

  return score;
}

const TOKEN_BUDGET_CHARS = 6000; // ~2,000 tokens at ~3 chars/token for Gemini

type ScoredDoc = { type: "doc"; id: string; label: string; content: string; score: number };
type ScoredSnippet = { type: "snippet"; label: string; content: string; score: number };
type ScoredEntry = ScoredDoc | ScoredSnippet;

function formatEntry(entry: ScoredEntry): string {
  if (entry.type === "doc") {
    return `[${entry.label}]\nLink: /api/documents/download?id=${entry.id}&mode=view\nSummary: ${entry.content}`;
  }
  return `[${entry.label}]: ${entry.content}`;
}

/**
 * Retrieve relevant program documents based on the user's message.
 * Returns formatted context string to inject into Sage's system prompt.
 *
 * Uses keyword matching on document titles, certification/platform IDs,
 * and sageContextNote content. Returns top 3 matches.
 *
 * Upgrade path: replace keyword matching with pgvector cosine similarity
 * if corpus grows beyond 200 documents. The function signature stays the same.
 */
export async function getDocumentContext(
  userMessage: string,
  callerRole: CallerRole = "student",
  maxResults: number = 3,
  tokenBudgetChars: number = TOKEN_BUDGET_CHARS,
): Promise<string> {
  if (!isSageRagEnabled()) return "";

  const messageLower = userMessage.toLowerCase();

  const [docs, snippets] = await Promise.all([
    loadSageDocuments(callerRole),
    loadSageSnippets(),
  ]);

  const scoredDocs: ScoredEntry[] = docs
    .map((doc) => ({
      type: "doc" as const,
      id: doc.id,
      label: doc.title,
      content: doc.sageContextNote || doc.title,
      score: scoreDocument(doc, messageLower),
    }))
    .filter((entry) => entry.score > 0);

  const scoredSnippets: ScoredEntry[] = snippets
    .map((snippet) => ({
      type: "snippet" as const,
      label: `Q&A: ${snippet.question}`,
      content: snippet.answer,
      score: scoreSnippet(snippet, messageLower),
    }))
    .filter((entry) => entry.score > 0);

  let combined = [...scoredDocs, ...scoredSnippets]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (combined.length === 0) return "";

  // Enforce token budget — drop lowest-scoring entries until under budget
  let totalChars = combined.reduce((sum, e) => sum + formatEntry(e).length, 0);
  while (totalChars > tokenBudgetChars && combined.length > 1) {
    combined = combined.slice(0, -1);
    totalChars = combined.reduce((sum, e) => sum + formatEntry(e).length, 0);
  }

  const content = combined.map(formatEntry).join("\n\n");

  return `\n\nPROGRAM DOCUMENT REFERENCE (use this for specific, accurate answers about program materials):\n${content}`;
}
