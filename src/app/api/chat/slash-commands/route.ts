// =============================================================================
// GET /api/chat/slash-commands
//
// Returns the slash-command palette the chat UI renders. Server-driven so
// adding a command is a backend-only change. Filtered by session role and
// the SAGE_AGENT_ENABLED feature flag.
// =============================================================================

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { getSlashCommandsForRole } from "@/lib/sage/agent/tools";

function isAgentEnabled(): boolean {
  return process.env.SAGE_AGENT_ENABLED === "true";
}

export const GET = withAuth(async (session) => {
  if (!isAgentEnabled()) {
    return NextResponse.json({ commands: [], agentEnabled: false });
  }

  const commands = getSlashCommandsForRole(session.role);
  return NextResponse.json({ commands, agentEnabled: true });
});
