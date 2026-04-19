import { NextResponse } from "next/server";

import { withCoordinatorAuth } from "@/lib/coordinator-auth";
import { listRegionsForSession } from "@/lib/region";

export const GET = withCoordinatorAuth("coordinator.dashboard.view", async (session) => {
  const regions = await listRegionsForSession(session);
  return NextResponse.json({ regions });
});
