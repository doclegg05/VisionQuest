import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import {
  PLACEMENT_BRIDGE_CONFIG_KEY,
  parsePlacementBridgeScope,
} from "@/lib/placement-bridge";
import { parseBody } from "@/lib/schemas";
import { getPlainConfigValue, setPlainConfigValue } from "@/lib/system-config";

// Operator surface for the Phase 0A placement-bridge pilot flag
// (SystemConfig "placement_bridge_classes", plain value). Accepted scopes:
//   ""    → bridge off
//   "all" → every class
//   CSV   → comma-separated SpokesClass ids (cuids), pilot classes only
const classIdSchema = z.string().cuid();

const scopeSchema = z.object({
  scope: z
    .string()
    .max(2000, "Scope value is too long.")
    .superRefine((value, ctx) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed.toLowerCase() === "all") return;

      const classIds = trimmed
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (classIds.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: 'Scope must be "", "all", or a comma-separated list of class IDs.',
        });
        return;
      }
      for (const classId of classIds) {
        if (!classIdSchema.safeParse(classId).success) {
          ctx.addIssue({
            code: "custom",
            message: `"${classId}" is not a valid class ID.`,
          });
        }
      }
    }),
});

export const GET = withAdminAuth(async () => {
  const raw = await getPlainConfigValue(PLACEMENT_BRIDGE_CONFIG_KEY);
  return NextResponse.json({
    raw,
    scope: parsePlacementBridgeScope(raw),
  });
});

export const PUT = withAdminAuth(async (session, req: NextRequest) => {
  const body = await parseBody(req, scopeSchema);
  const scope = body.scope.trim();

  await setPlainConfigValue(PLACEMENT_BRIDGE_CONFIG_KEY, scope, session.id);

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.placement_bridge.update",
    targetType: "system_config",
    targetId: PLACEMENT_BRIDGE_CONFIG_KEY,
    summary: `Admin set the placement bridge scope to "${scope || "(off)"}".`,
  });

  return NextResponse.json({
    success: true,
    raw: scope,
    scope: parsePlacementBridgeScope(scope),
  });
});
