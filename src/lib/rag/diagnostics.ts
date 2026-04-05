// src/lib/rag/diagnostics.ts

import { logger } from "@/lib/logger";
import type { RetrievalDiagnostic } from "./types";

/**
 * Log retrieval diagnostics at two levels:
 * - info: summary (conversationId, queryType, confidence, chunk count, latency, fallback)
 * - debug: full trace (all fields)
 */
export function logRetrieval(diagnostic: RetrievalDiagnostic): void {
  logger.info("rag:retrieval", {
    conversationId: diagnostic.conversationId,
    queryType: diagnostic.queryType,
    rewriteSkipped: diagnostic.rewriteSkipped,
    confidence: diagnostic.confidenceScore,
    chunksReturned: diagnostic.finalIncluded.length,
    fallbackUsed: diagnostic.fallbackUsed,
    uploadedDocsInfluenced: diagnostic.uploadedDocsInfluenced,
    latencyMs: diagnostic.latencyMs,
  });

  logger.debug(
    "rag:retrieval:trace",
    diagnostic as unknown as Record<string, unknown>,
  );
}
