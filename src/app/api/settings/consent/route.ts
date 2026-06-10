import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, badRequest } from "@/lib/api-error";
import {
  consentScopeSchema,
  grantConsent,
  hasActiveConsent,
  revokeConsent,
} from "@/lib/consent";

/**
 * GET /api/settings/consent?scope=cloud_file_processing — current consent state.
 * POST /api/settings/consent { scope, granted } — self-service grant/revoke.
 *
 * Student-scoped: a session can only manage its own consent. Staff changes
 * go through staff tooling (recordedBy preserved either way).
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const scope = consentScopeSchema.safeParse(url.searchParams.get("scope"));
  if (!scope.success) throw badRequest("Unknown consent scope.");

  const active = await hasActiveConsent(session.id, scope.data);
  return NextResponse.json({ success: true, data: { scope: scope.data, granted: active } });
});

const postSchema = z.object({
  scope: consentScopeSchema,
  granted: z.boolean(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = postSchema.safeParse(await req.json());
  if (!body.success) throw badRequest("Invalid consent request.");

  const { scope, granted } = body.data;
  if (granted) {
    await grantConsent(session.id, scope, session.id);
  } else {
    await revokeConsent(session.id, scope, session.id);
  }

  return NextResponse.json({ success: true, data: { scope, granted } });
});
