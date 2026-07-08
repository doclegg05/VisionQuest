// =============================================================================
// GET /api/chat/slash-commands
//
// Returns the slash-command palette the chat UI renders. Server-driven so
// adding a command is a backend-only change. Filtered by session role and
// the shared agent-mode flag (SAGE_AGENT_MODE, legacy SAGE_AGENT_ENABLED).
// getSlashCommandsForRole already mode-filters the tool set, so in readonly
// mode only read-tier commands surface.
// =============================================================================

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { getSlashCommandsForRole } from "@/lib/sage/agent/tools";
import { isAgentLoopEnabled } from "@/lib/sage/agent/flags";

export const GET = withAuth(async (session) => {
  if (!isAgentLoopEnabled()) {
    return NextResponse.json({ commands: [], agentEnabled: false });
  }

  const commands = getSlashCommandsForRole(session.role);
  return NextResponse.json({ commands, agentEnabled: true });
});
