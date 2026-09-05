import { NextResponse } from "next/server";

import { forbidden, withAuth } from "@/lib/api-error";
import { ConnectionError, withdrawConnection } from "@/lib/connect/connections";

/**
 * POST /api/connect/[id]/withdraw — the student takes it back (Task 4.5).
 *
 * Reachable from every non-terminal state, deliberately including `sent` and
 * `interested`: "the student can withdraw at any time" (design spec §7). The
 * employer token is cleared in the same write, so the link stops resolving
 * rather than merely stopping at a status check.
 *
 * NOT gated on `connect_enabled_classes`. Turning the pilot off for a class
 * must never take away a student's ability to withdraw something already sent
 * in their name.
 */
export const POST = withAuth(
  async (session, _req: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;

    if (session.role !== "student") {
      throw forbidden("Only the student can withdraw their own introduction.");
    }

    try {
      await withdrawConnection(id, session.id);
      return NextResponse.json({ success: true, data: { id, status: "withdrawn" } });
    } catch (error) {
      if (error instanceof ConnectionError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  },
);
