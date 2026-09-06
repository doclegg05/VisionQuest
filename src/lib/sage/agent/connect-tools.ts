// =============================================================================
// propose_connection — the student's own "I want that one".
//
// Match & Connect Phase 4, Task 4.3 (design spec §6 step 1, §9).
//
// This is a PROPOSAL and nothing else. It lands on the instructor's board and
// on the student's own approval card; the student's tap on that card is the
// consent event, and the instructor is the one who sends. Sage never approves
// on the student's behalf and never sends — the whole design rests on those
// two facts, which is why the tool creates a row in `proposed` and stops.
//
// Behind `confirmationGate` at `mutate_consequential`: proposing puts a named
// student in front of an instructor for a specific employer, which is not
// something to do because a model misread a sentence.
// =============================================================================

import { prisma } from "@/lib/db";
import { ConnectionError, proposeConnection } from "@/lib/connect/connections";
import { isConnectEnabledForStudent } from "@/lib/connect/flags";
import { packetFieldList } from "@/lib/connect/packet-shared";
import { sanitizeForPrompt } from "@/lib/sage/system-prompts";

import { confirmationGate, executeAndLedger } from "./write-tools";
import type { AgentTool, AgentToolResult } from "./types";

const proposeConnectionTool: AgentTool = {
  name: "propose_connection",
  description:
    "Ask the student's instructor to introduce them to the employer behind one job lead. Creates a proposal only — the student must then approve exactly what would be shared, and the instructor is the one who sends it. Requires user confirmation.",
  parameters: {
    type: "object",
    properties: {
      jobLeadId: {
        type: "string",
        description: "The jobLeadId of a lead returned by search_jobs.",
      },
    },
    required: ["jobLeadId"],
  },
  requiredRoles: ["student"],
  riskTier: "mutate_consequential",
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const jobLeadId = String(args.jobLeadId ?? "");
    const studentId = ctx.session.id;

    if (!(await isConnectEnabledForStudent(studentId))) {
      return {
        status: "error",
        summary: "Asking an employer to meet you isn't turned on for your class yet.",
        modelHint:
          "propose_connection is off for this student's class. Tell them their instructor " +
          "handles introductions for now, and offer to help them get ready instead. Do NOT " +
          "say a proposal was made.",
      };
    }

    // Named in the confirm card, so the student is confirming a real opening
    // and not an id. RLS decides what a student may read here: a lead outside
    // their class simply is not found.
    const lead = await prisma.jobLead.findUnique({
      where: { id: jobLeadId },
      select: { id: true, title: true, status: true, employer: { select: { name: true } } },
    });
    if (!lead) return { status: "error", summary: "I couldn't find that job." };
    if (lead.status !== "open") {
      return { status: "error", summary: "That job isn't open right now." };
    }

    // Lead text is instructor- or employer-entered, so it is third-party data
    // on the same footing as a scraped posting: sanitized once, here, before
    // it can reach the card, the summary, the modelHint or `data`.
    const title = sanitizeForPrompt(lead.title);
    const employerName = sanitizeForPrompt(lead.employer.name);

    const gate = await confirmationGate(
      "propose_connection",
      { jobLeadId },
      ctx,
      `Ask your teacher to send your information to ${employerName} for the ${title} job? ` +
        "You will see exactly what would be sent, and nothing goes until you say OK.",
      "Ask my teacher",
    );
    if (gate) return gate;

    return executeAndLedger("propose_connection", { jobLeadId }, ctx, async () => {
      try {
        const { id, packet } = await proposeConnection({
          studentId,
          jobLeadId,
          proposedById: studentId,
          proposedVia: "sage",
        });
        const fields = packetFieldList(packet);
        return {
          summary:
            `Done — your teacher will see that you want the ${title} job at ${employerName}. ` +
            "Next you will get a card asking if it is OK to send: " +
            `${fields.join(", ")}. Nothing goes to the employer until you say yes.`,
          data: { connectionId: id, jobLeadId, fields },
        };
      } catch (error) {
        if (error instanceof ConnectionError) {
          // A real, expected outcome (already proposed, lead closed, employer
          // on do-not-contact) — the student gets the reason, not "that
          // didn't work".
          throw new Error(error.message);
        }
        throw error;
      }
    });
  },
};

export const CONNECT_TOOLS: AgentTool[] = [proposeConnectionTool];
