// src/lib/rag/query-classifier.ts

import type { QueryType } from "./types";

// ---------------------------------------------------------------------------
// Pattern definitions (order matters — checked top-to-bottom)
// ---------------------------------------------------------------------------

const CONVERSATION_MEMORY_PATTERNS: RegExp[] = [
  /\bwhat\s+did\s+(i|we)\s+(say|talk|discuss|mention)/i,
  /\b(earlier|before|last\s+time|previously)\b.*\b(said|talked|discussed|mentioned)/i,
  /\bremind\s+me\s+what\b/i,
  /\bwhat\s+(did\s+)?(we|i)\s+(talk|chat)\s+about\b/i,
  /\bdo\s+you\s+remember\s+(when|what)\b/i,
];

const PERSONAL_STATUS_PATTERNS: RegExp[] = [
  /\bhow\s+am\s+i\s+doing\b/i,
  /\bmy\s+(\w+\s+)?(progress|goals?|status|xp|streak|readiness|portfolio)\b/i,
  /\bwhat\s+(certifications?|goals?)\s+(do|have)\s+i\s+(have|got|earned|completed)\b/i,
  /\bwhat\s+goals?\s+(do|have)\s+i\b/i,
  /\bwhat\s+(are\s+)?my\s+(\w+\s+)?(goals?|certifications?|progress)\b/i,
  /\b(am\s+i|i\s+am)\s+(on\s+track|ready|behind|ahead)\b/i,
];

const PLATFORM_NAMES =
  /\b(gmetrix|edgenuity|khan|burlington|certiport|skillpath|essentialed|aztec|csmlearn|learnkey)\b/i;

const ACCESS_WORDS =
  /\b(log\s*(in|into)|sign\s*in|access|account|password|login|signin)\b/i;

const APP_NAVIGATION_PATTERNS: RegExp[] = [
  /\bwhere\s+(do|can|should|would)\s+i\s+(find|upload|see|view|check|go|look)\b/i,
  /\bhow\s+(do|can|should|would)\s+i\s+(use|navigate|access|open|get\s+to|find|upload)\b/i,
  /\b(portfolio|vision\s*board|dashboard|profile|settings)\b.*\b(page|tab|section|screen)\b/i,
  /\b(page|tab|section|screen)\b.*\b(portfolio|vision\s*board|dashboard|profile|settings)\b/i,
  /\bwhere\s+is\s+(the|my)\s+\w+/i,
];

/** Navigation verb phrases — when present, the message is asking "how/where"
 *  rather than inquiring about personal status. */
const NAVIGATION_INTENT =
  /\b(where\s+(do|can|should|would|is)\b|how\s+(do|can|should|would)\s+i\s+(use|navigate|access|open|get\s+to|find|upload))\b/i;

const PERSONAL_REFS = /\b(i|my|me|i'm|i've|i'll)\b/i;

const DOCUMENT_REFS =
  /\b(certification|certifications|form|forms|policy|policies|requirement|requirements|attendance|rtw|ready\s+to\s+work)\b/i;

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a user message into one of six query types using rule-based
 * pattern matching. Patterns are checked in priority order; the first
 * match wins. When no specific pattern matches, defaults to "document".
 */
export function classifyQuery(message: string): QueryType {
  // 1. conversation_memory
  if (CONVERSATION_MEMORY_PATTERNS.some((p) => p.test(message))) {
    return "conversation_memory";
  }

  // 2. personal_status (skip when the message has a navigation intent)
  if (
    !NAVIGATION_INTENT.test(message) &&
    PERSONAL_STATUS_PATTERNS.some((p) => p.test(message))
  ) {
    return "personal_status";
  }

  // 3. external_platform (requires BOTH platform name AND access word)
  if (PLATFORM_NAMES.test(message) && ACCESS_WORDS.test(message)) {
    return "external_platform";
  }

  // 4. app_navigation
  if (APP_NAVIGATION_PATTERNS.some((p) => p.test(message))) {
    return "app_navigation";
  }

  // 5. mixed (personal refs + document-like refs)
  if (PERSONAL_REFS.test(message) && DOCUMENT_REFS.test(message)) {
    return "mixed";
  }

  // 6. Default
  return "document";
}
