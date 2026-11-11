/**
 * The one shape a failed Sage turn is reported in, on a JSON error body and
 * on the SSE error event alike: the fixed sentence (with the 988 block for a
 * crisis message), the cause code, the 988 block on its own so the chat can
 * keep it in view when Try again runs, and the saved message's id and its
 * conversation so Try again can point at it in the same conversation.
 */

import { ApiError } from "@/lib/api-error";
import { errorForLog } from "@/lib/log-error";
import { studentLogKey } from "@/lib/log-keys";
import { logger } from "@/lib/logger";
import { offersRetry, sageFailureMessage, type SageFailureAudience, type SageFailureCode } from "./sage-failure";
import type { UserTurn } from "./retry-turn";

export interface FailureBodyInput {
  failure: SageFailureCode;
  audience: SageFailureAudience;
  /** The 988 block for a crisis message, or "". */
  crisisBlock: string;
  /** The student's saved message, or null when nothing was saved. */
  userMessageId: string | null;
  /** The conversation that message is in, or null before one exists. */
  conversationId: string | null;
  /** The viewer is an admin, who holds Program Setup. */
  isAdmin?: boolean;
}

export interface FailureBody {
  error: string;
  failure: SageFailureCode;
  crisisBlock?: string;
  userMessageId?: string;
  conversationId?: string;
}

export function failureBody(input: FailureBodyInput): FailureBody {
  const { failure, audience, crisisBlock, userMessageId, conversationId } = input;
  const sentence = sageFailureMessage(failure, {
    audience,
    messageSaved: userMessageId !== null,
    canRetry: offersRetry(failure),
    isAdmin: input.isAdmin ?? false,
  });
  return {
    error: sentence + crisisBlock,
    failure,
    ...(crisisBlock ? { crisisBlock } : {}),
    ...(userMessageId ? { userMessageId } : {}),
    ...(conversationId ? { conversationId } : {}),
  };
}

export function failureResponse(input: FailureBodyInput, status: number): Response {
  return new Response(JSON.stringify(failureBody(input)), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface PreStreamContext {
  audience: SageFailureAudience;
  crisisBlock: string;
  userTurn: UserTurn;
  studentId: string;
}

/**
 * Runs the part of a send before the stream opens (saving the message,
 * loading staff context, RAG and history). A throw there answers with the
 * fixed `unknown` sentence and the 988 block instead of the framework's
 * "Internal server error". A request error (4xx) still answers as itself.
 */
export async function answerPreStreamFailures(run: () => Promise<Response>, context: PreStreamContext): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError && error.statusCode < 500) throw error;
    logger.error("Chat send failed before the stream opened", {
      error: errorForLog(error),
      student: studentLogKey(context.studentId),
    });
    return failureResponse(
      {
        failure: "unknown",
        audience: context.audience,
        crisisBlock: context.crisisBlock,
        userMessageId: context.userTurn.savedId(),
        conversationId: context.userTurn.conversationId(),
      },
      500,
    );
  }
}
