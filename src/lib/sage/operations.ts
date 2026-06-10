/**
 * Sage operation ledger (Phase 3, TEKTON pattern).
 *
 * Every write tool execution records a SageOperation row + an AuditLog entry.
 * Deterministic ids (op-{timestamp}-{slug}) make retried tool invocations
 * idempotent: re-recording the same operation id is a no-op update, not a
 * duplicate row.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

export type OperationStatus = "proposed" | "confirmed" | "executed" | "failed" | "rejected";
export type OperationActorType = "student" | "teacher" | "admin" | "system";

/** Deterministic id; clock injected for testability (no Date.now() inline). */
export function operationIdFor(slug: string, clock: Date): string {
  const normalizedSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `op-${clock.getTime()}-${normalizedSlug}`;
}

export interface RecordOperationParams {
  id: string;
  actorType: OperationActorType;
  actorId: string;
  actorRole: string;
  toolName: string;
  status: OperationStatus;
  payload: Prisma.InputJsonValue;
  resultSummary?: string;
}

export async function recordOperation(params: RecordOperationParams): Promise<void> {
  await prisma.sageOperation.upsert({
    where: { id: params.id },
    create: {
      id: params.id,
      actorType: params.actorType,
      actorId: params.actorId,
      toolName: params.toolName,
      status: params.status,
      payload: params.payload,
      resultSummary: params.resultSummary ?? null,
    },
    update: {
      status: params.status,
      resultSummary: params.resultSummary ?? null,
    },
  });

  await logAuditEvent({
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: `sage_tool.${params.toolName}.${params.status}`,
    targetType: "sage_operation",
    targetId: params.id,
    summary: params.resultSummary ?? `${params.toolName} ${params.status}`,
  });
}
