import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
import { syncSageDocuments } from "@/lib/sage/ingest";
import { logAuditEvent } from "@/lib/audit";

/**
 * POST /api/teacher/documents/sage-context/sync
 *
 * Scans docs-upload/ and ingests new/changed files into ProgramDocument.
 * Rate limited: 1 sync per 10 minutes (all roles).
 */
export const POST = withTeacherAuth(async (session) => {
  // Rate limit: 1 sync per 10 minutes
  const rl = await rateLimit(`sage-sync:global`, 1, 10 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Sync was run recently. Please wait before syncing again." },
      { status: 429 },
    );
  }

  const result = await syncSageDocuments({ geminiBudget: 30 });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "sage.knowledge_sync",
    targetType: "program_document",
    targetId: "bulk",
    summary: `Sage knowledge sync: ${result.added} added, ${result.updated} updated, ${result.orphaned} orphaned, ${result.errors.length} errors.`,
    metadata: { ...result, errors: result.errors.slice(0, 10) },
  });

  return NextResponse.json({ success: true, result });
});
