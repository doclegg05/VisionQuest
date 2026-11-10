/**
 * Try again without a second copy of the student's message.
 *
 * The chat route saves the student's message before it calls the model, so
 * a failed reply leaves that message in the transcript. A Try again sends
 * `retryOf` with the saved message's id; when it checks out, the route
 * reuses that row instead of saving the text again, and skips the crisis
 * scan, which already ran on the first send. The history the model reads is
 * then the same as for the first send, without the duplicate user turn.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { chatSendSchema } from "@/lib/schemas";
import { saveMessage } from "./conversation";

export const chatSendBodySchema = chatSendSchema.extend({
  retryOf: z.string().cuid("Invalid message ID.").optional(),
});

export type ChatSendBody = z.infer<typeof chatSendBodySchema>;

export interface RetriedMessage {
  id: string;
  conversationId: string;
}

interface RetryLookup {
  studentId: string;
  conversationId: string | null;
  retryOf: string | undefined;
  content: string;
}

/**
 * The stored message a Try again points at, or null to save the message as
 * new. It must be this account's, in this conversation, with the same text,
 * and still the latest question there. Never throws: a failed lookup saves
 * the message as new, which is what happened before Try again existed.
 */
export async function findRetriedUserMessage(lookup: RetryLookup): Promise<RetriedMessage | null> {
  const { studentId, conversationId, retryOf, content } = lookup;
  if (!retryOf || !conversationId) return null;
  try {
    const stored = await prisma.message.findFirst({
      where: { id: retryOf, studentId, conversationId, role: "user", content },
      select: { id: true, conversationId: true },
    });
    if (!stored) return null;
    const latest = await prisma.message.findFirst({
      where: { conversationId, studentId, role: "user" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return latest?.id === stored.id ? stored : null;
  } catch (error) {
    logger.warn("Chat retry lookup failed; saving the message as new", { error: errorForLog(error) });
    return null;
  }
}

export interface UserTurn {
  /** Saves the student's message, or reuses the retried copy. Returns its id. */
  save(conversationId: string): Promise<string>;
  /** The saved message's id, or null while nothing is saved. */
  savedId(): string | null;
}

export function createUserTurn(studentId: string, message: string, retried: RetriedMessage | null): UserTurn {
  let saved: string | null = null;
  return {
    async save(conversationId) {
      if (retried && retried.conversationId === conversationId) {
        saved = retried.id;
        return saved;
      }
      const row = await saveMessage(conversationId, studentId, "user", message);
      saved = row.id;
      return saved;
    },
    savedId: () => saved,
  };
}
