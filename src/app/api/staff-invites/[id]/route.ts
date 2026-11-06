import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, withAuth } from "@/lib/api-error";
import { assertInviterRole, withInviteRefusals } from "@/lib/staff-invite-http";
import { revokeStaffInvite } from "@/lib/staff-invites";

const idSchema = z.string().cuid();

export const DELETE = withAuth(
  async (session, _req: Request, ctx: { params: Promise<{ id: string }> }) => {
    assertInviterRole(session);
    const parsed = idSchema.safeParse((await ctx.params).id);
    if (!parsed.success) throw badRequest("That invite could not be found.");

    return withInviteRefusals(async () => {
      await revokeStaffInvite(session, parsed.data);
      return NextResponse.json({ success: true, data: { revoked: true } });
    });
  },
);
