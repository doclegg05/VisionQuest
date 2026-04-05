// src/lib/rag/query-rewriter.ts

import type { RewrittenQuery } from "./types";
import { classifyQuery } from "./query-classifier";
import { getProvider } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// Patterns that signal an unresolved conversational reference
// ---------------------------------------------------------------------------

/** Pronouns / demonstratives without a clear antecedent */
const PRONOUN_PATTERNS: RegExp[] = [
  /\bit\b/i,
  /\bthat\s+one\b/i,
  /\bthe\s+other\s+one\b/i,
  /\bthis\b/i,
];

/** Follow-up phrases that depend on prior context */
const FOLLOWUP_PATTERNS: RegExp[] = [
  /\bwhat\s+about\b/i,
  /\btell\s+me\s+more\b/i,
  /\band\s+the\b/i,
  /\bhow\s+about\b/i,
];

/** Part / sequence references */
const PART_PATTERNS: RegExp[] = [
  /\bpart\s+\d+\b/i,
  /\bthe\s+second\b/i,
  /\bthe\s+next\b/i,
];

/** Specific identifiers that indicate the message is already self-contained */
const SPECIFIC_IDENTIFIER =
  /\b(IC3|MOS|DFA-TS-\d+|GMetrix|Edgenuity|Certiport|WorkKeys|SPOKES|Ready\s+to\s+Work)\b/i;

// ---------------------------------------------------------------------------
// shouldRewrite
// ---------------------------------------------------------------------------

/**
 * Returns true when the message contains unresolved conversational references
 * that need prior context to be understood as a standalone search query.
 */
export function shouldRewrite(message: string): boolean {
  const trimmed = message.trim();

  // Follow-up phrases always need rewriting
  if (FOLLOWUP_PATTERNS.some((p) => p.test(trimmed))) {
    return true;
  }

  // Part / sequence references always need rewriting
  if (PART_PATTERNS.some((p) => p.test(trimmed))) {
    return true;
  }

  // Short vague messages (< 4 words, no specific identifiers)
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 4 && !SPECIFIC_IDENTIFIER.test(trimmed)) {
    return true;
  }

  // Messages with specific identifiers and no pronoun references are explicit
  if (SPECIFIC_IDENTIFIER.test(trimmed)) {
    return false;
  }

  // Pronoun references without a specific identifier need rewriting
  if (PRONOUN_PATTERNS.some((p) => p.test(trimmed))) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// rewriteQuery
// ---------------------------------------------------------------------------

const REWRITE_SYSTEM_PROMPT = `You are a search query rewriter. Given a conversation and the latest message, rewrite the latest message as a standalone search query.

Rules:
- Preserve exact identifiers (IC3, MOS, DFA-TS-12, etc.) verbatim
- Do not broaden or add speculative synonyms
- Emit one standalone query
- Also identify any resolved entities (specific names, IDs, topics)
- Classify the query type as one of: document, app_navigation, external_platform, conversation_memory, personal_status, mixed

Return JSON: { "standaloneQuery": "...", "resolvedEntities": [...], "queryType": "..." }`;

/**
 * Conditionally rewrites a user message into a standalone search query by
 * resolving conversational references using recent chat history.
 *
 * When the message is already self-contained (`shouldRewrite` returns false),
 * the original message is returned with `skipRewrite: true`.
 */
export async function rewriteQuery(
  message: string,
  recentMessages: { role: string; content: string }[],
  userId: string,
): Promise<RewrittenQuery> {
  // Fast path — message is already explicit
  if (!shouldRewrite(message)) {
    return {
      standaloneQuery: message,
      resolvedEntities: [],
      queryType: classifyQuery(message),
      skipRewrite: true,
    };
  }

  try {
    const provider = await getProvider(userId);

    // Take the last 5 messages (or fewer) for context
    const contextMessages = recentMessages.slice(-5);

    // Build the LLM conversation: context messages + the current message
    const llmMessages = [
      ...contextMessages.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("model" as const),
        content: m.content,
      })),
      {
        role: "user" as const,
        content: `Rewrite this message as a standalone search query:\n\n"${message}"`,
      },
    ];

    const rawJson = await provider.generateStructuredResponse(
      REWRITE_SYSTEM_PROMPT,
      llmMessages,
    );

    const parsed: unknown = JSON.parse(rawJson);

    // Validate shape
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "standaloneQuery" in parsed &&
      typeof (parsed as Record<string, unknown>).standaloneQuery === "string"
    ) {
      const result = parsed as {
        standaloneQuery: string;
        resolvedEntities?: string[];
        queryType?: string;
      };

      const validQueryTypes = new Set([
        "document",
        "app_navigation",
        "external_platform",
        "conversation_memory",
        "personal_status",
        "mixed",
      ]);

      return {
        standaloneQuery: result.standaloneQuery,
        resolvedEntities: Array.isArray(result.resolvedEntities)
          ? result.resolvedEntities
          : [],
        queryType: validQueryTypes.has(result.queryType ?? "")
          ? (result.queryType as RewrittenQuery["queryType"])
          : classifyQuery(result.standaloneQuery),
        skipRewrite: false,
      };
    }

    // Parsed but wrong shape — fall back
    return {
      standaloneQuery: message,
      resolvedEntities: [],
      queryType: classifyQuery(message),
      skipRewrite: true,
    };
  } catch {
    // LLM failure or bad JSON — fall back gracefully
    return {
      standaloneQuery: message,
      resolvedEntities: [],
      queryType: classifyQuery(message),
      skipRewrite: true,
    };
  }
}
