import { prisma } from "./db";

interface AuditEventInput {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAuditEvent(input: AuditEventInput) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      summary: input.summary ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}
