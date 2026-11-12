/**
 * Try again without a second copy of the student's message.
 *
 * The chat route saves the student's message before it calls the model, so
 * a failed reply leaves that message in the transcript. A Try again sends
 * `retryOf` with the saved message's id; when it checks out, the route
 * reuses that row instead of saving the text again. The crisis scan still
 * runs, because the first send's alert may have failed; it dedupes by
 * student and day. The history the model reads is then the same as for the
 * first send, without the duplicate user turn, plus any partial reply Sage
 * saved before it was cut off.
 *
 * A Try again whose question already has a full answer after it (a double
 * tap whose first request finished) is refused with a 409, so no second
 * answer is saved. Two taps that both arrive before either answer is saved
 * are not caught here; the chat's own guard stops those.
 */

import { z } from "zod";
import { conflict } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { chatSendSchema } from "@/lib/schemas";
import { saveMessage } from "./conversation";
import { CUT_OFF_MARKS } from "./sage-failure";

/** The 409's text; the registry middleware sends it to the student as is. */
export const ALREADY_ANSWERED = "Sage already sent the answer. It is above.";

/**
 * How recent a saved copy must be for a Try again with no saved id to reuse
 * it (E9b 6). The chat's own timeout is 20 seconds, so a real retry comes
 * well inside this; an older identical message is a new question.
 */
export const UNSAVED_RETRY_WINDOW_MS = 5 * 60_000;

export const chatSendBodySchema = chatSendSchema.extend({
  // null: a Try again that never learned the saved id (E9b 6).
  retryOf: z.string().cuid("Invalid message ID.").nullable().optional(),
});

export type ChatSendBody = z.infer<typeof chatSendBodySchema>;

export interface RetriedMessage {
  id: string;
  conversationId: string;
}

interface RetryLookup {
  studentId: string;
  conversationId: string | null;
  /** The saved id, null for a Try again that never got one, undefined for a plain send. */
  retryOf: string | null | undefined;
  content: string;
}

/**
 * The stored message a Try again points at, or null to save the message as
 * new. It must be this account's, in this conversation, with the same text,
 * and still the latest question there. A failed lookup saves the message as
 * new, which is what happened before Try again existed. Throws a 409 when
 * the question already has a full answer.
 */
export async function findRetriedUserMessage(lookup: RetryLookup): Promise<RetriedMessage | null> {
  const { retryOf, conversationId } = lookup;
  if (retryOf === null && conversationId) return lookUpUnsavedRetry(lookup, conversationId);
  if (!retryOf || !conversationId) return null;
  const found = await lookUpRetry(lookup, retryOf, conversationId);
  if (found === "answered") throw conflict(ALREADY_ANSWERED);
  return found;
}

async function lookUpRetry(
  lookup: RetryLookup,
  retryOf: string,
  conversationId: string,
): Promise<RetriedMessage | "answered" | null> {
  const { studentId, content } = lookup;
  try {
    const stored = await prisma.message.findFirst({
      where: { id: retryOf, studentId, conversationId, role: "user", content },
      select: { id: true, conversationId: true, createdAt: true },
    });
    if (!stored) return null;
    const latest = await prisma.message.findFirst({
      where: { conversationId, studentId, role: "user" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latest?.id !== stored.id) return null;
    if (await hasFullAnswerAfter(studentId, conversationId, stored.createdAt)) return "answered";
    return { id: stored.id, conversationId: stored.conversationId };
  } catch (error) {
    logger.warn("Chat retry lookup failed; saving the message as new", { error: errorForLog(error) });
    return null;
  }
}

/**
 * A Try again after the chat's own timeout (E9b 6): no saved id came back,
 * but the route may have saved the message anyway. Reuse the newest message
 * in this conversation when it is this account's, says the same thing, is
 * recent, and has no full answer after it. Otherwise save it as new; a new
 * conversation cannot be matched, which is accepted.
 */
async function lookUpUnsavedRetry(lookup: RetryLookup, conversationId: string): Promise<RetriedMessage | null> {
  const { studentId, content } = lookup;
  try {
    const latest = await prisma.message.findFirst({
      where: { conversationId, studentId, role: "user" },
      orderBy: { createdAt: "desc" },
      select: { id: true, conversationId: true, content: true, createdAt: true },
    });
    if (!latest || latest.content !== content) return null;
    if (Date.now() - latest.createdAt.getTime() > UNSAVED_RETRY_WINDOW_MS) return null;
    if (await hasFullAnswerAfter(studentId, conversationId, latest.createdAt)) return null;
    return { id: latest.id, conversationId: latest.conversationId };
  } catch (error) {
    logger.warn("Chat retry lookup failed; saving the message as new", { error: errorForLog(error) });
    return null;
  }
}

/**
 * Any reply after the question that is not a cut-off partial. A full answer
 * can be followed by a cut-off copy of itself (the client left before `done`),
 * so the newest reply alone is not enough.
 */
async function hasFullAnswerAfter(studentId: string, conversationId: string, after: Date): Promise<boolean> {
  const reply = await prisma.message.findFirst({
    where: {
      conversationId,
      studentId,
      role: "assistant",
      createdAt: { gt: after },
      NOT: { OR: CUT_OFF_MARKS.map((mark) => ({ content: { contains: mark } })) },
    },
    select: { id: true },
  });
  return reply !== null;
}

export interface UserTurn {
  /** Saves the student's message, or reuses the retried copy. Returns its id. */
  save(conversationId: string): Promise<string>;
  /** The saved message's id, or null while nothing is saved. */
  savedId(): string | null;
  /** The conversation the message is saved in, or null before the save. */
  conversationId(): string | null;
}

export function createUserTurn(studentId: string, message: string, retried: RetriedMessage | null): UserTurn {
  let saved: string | null = null;
  let conversation: string | null = null;
  return {
    async save(conversationId) {
      conversation = conversationId;
      if (retried && retried.conversationId === conversationId) {
        saved = retried.id;
        return saved;
      }
      const row = await saveMessage(conversationId, studentId, "user", message);
      saved = row.id;
      return saved;
    },
    savedId: () => saved,
    conversationId: () => conversation,
  };
}
