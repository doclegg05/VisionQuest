/**
 * Why Sage could not answer, decided once on the server and sent to the
 * client as a code (`failure` on the error body or SSE error event). The
 * client never parses the error text to find the cause.
 *
 * The sentences are for adults who may read at a 6th-grade level, on a
 * phone. Each says what happened and what the student can do. "Your message
 * was not lost" appears only when the route had already saved the student's
 * message before the failure, which is true on the stream path and false on
 * the provider-setup path (src/app/api/chat/send/route.ts).
 */

import type { AIProvider } from "@/lib/ai/types";

export const SAGE_FAILURE_CODES = ["off", "busy", "slow", "not_set_up", "unknown"] as const;

export type SageFailureCode = (typeof SAGE_FAILURE_CODES)[number];

export type SageFailureAudience = "student" | "staff";

export interface SageFailureMessageOptions {
  audience: SageFailureAudience;
  /** True only when the student's message is already in the transcript. */
  messageSaved: boolean;
  /** True only when a Try again button shows under this sentence. */
  canRetry: boolean;
  /** An admin holds Program Setup, so they are told to check it themselves. */
  isAdmin?: boolean;
}

/** Off and not set up need a person to fix something; a retry cannot help. */
const RETRYABLE: ReadonlySet<SageFailureCode> = new Set<SageFailureCode>(["busy", "slow", "unknown"]);

/** Whether a Try again button shows for this cause. */
export function offersRetry(code: SageFailureCode): boolean {
  return RETRYABLE.has(code);
}

const WHAT_HAPPENED: Record<SageFailureCode, Record<SageFailureAudience, string>> = {
  off: { student: "Sage is off right now.", staff: "Sage is off right now." },
  busy: {
    student: "Sage is helping other students right now.",
    staff: "Sage is helping other people right now.",
  },
  slow: { student: "Sage is taking too long to answer.", staff: "Sage is taking too long to answer." },
  not_set_up: { student: "Sage is not set up yet.", staff: "Sage is not set up yet." },
  unknown: { student: "Sage could not answer this time.", staff: "Sage could not answer this time." },
};

const STILL_USE = "You can still use the rest of VisionQuest.";

/** What to do, keyed by whether a Try again button shows. */
type NextStep = Record<SageFailureAudience, { retry: string; noRetry: string }>;

function same(text: string): { retry: string; noRetry: string } {
  return { retry: text, noRetry: text };
}

const WHAT_TO_DO: Record<SageFailureCode, NextStep> = {
  off: {
    student: same(`Tell your instructor. ${STILL_USE}`),
    staff: same(`The computer that runs Sage may be off or offline. Tell the person who runs it. ${STILL_USE}`),
  },
  busy: {
    student: { retry: "Wait a little, then tap Try again.", noRetry: "Wait a little, then send your message again." },
    staff: { retry: "Wait a little, then tap Try again.", noRetry: "Wait a little, then send your message again." },
  },
  slow: {
    student: { retry: "Tap Try again.", noRetry: "Send your message again." },
    staff: { retry: "Tap Try again.", noRetry: "Send your message again." },
  },
  not_set_up: {
    student: same(`Tell your instructor. ${STILL_USE}`),
    staff: same("An admin needs to check the Sage connection settings."),
  },
  unknown: {
    student: {
      retry: "Tap Try again. If it keeps happening, tell your instructor.",
      noRetry: "Send your message again. If it keeps happening, tell your instructor.",
    },
    staff: {
      retry: "Tap Try again. If it keeps happening, tell an admin.",
      noRetry: "Send your message again. If it keeps happening, tell an admin.",
    },
  },
};

const NOT_LOST = "Your message was not lost.";

/** Not set up, for an admin: the Open Program Setup link sits beside it. */
const ADMIN_NOT_SET_UP_STEP = "Check the Sage connection settings in Program Setup.";

function nextStep(code: SageFailureCode, options: SageFailureMessageOptions): string {
  if (code === "not_set_up" && options.audience === "staff" && options.isAdmin) return ADMIN_NOT_SET_UP_STEP;
  const step = WHAT_TO_DO[code][options.audience];
  return options.canRetry ? step.retry : step.noRetry;
}

export function sageFailureMessage(code: SageFailureCode, options: SageFailureMessageOptions): string {
  const parts = [
    WHAT_HAPPENED[code][options.audience],
    options.messageSaved ? NOT_LOST : null,
    nextStep(code, options),
  ];
  return parts.filter((part): part is string => part !== null).join(" ");
}

/** The note under a reply that stopped partway, while Try again shows. */
export const CUT_OFF_NOTE = "(Sage got cut off. Tap Try again for the full answer.)";

/** The same note once Try again ran: the new answer is under it. */
export const RETRIED_CUT_OFF_NOTE = "(Sage got cut off. The new answer is below.)";

/** The same note as saved: a reload shows no Try again, so it names no button. */
export const SAVED_CUT_OFF_NOTE = "(Sage got cut off here.)";

/** The start every cut-off note shares, shown or saved. */
const CUT_OFF_MARK = "\n\n(Sage got cut off";

/**
 * A partial reply as the student sees it while Try again shows: the text
 * Sage sent, then what happened.
 */
export function cutOffReply(partial: string, code: SageFailureCode, audience: SageFailureAudience): string {
  if (offersRetry(code)) return `${partial}\n\n${CUT_OFF_NOTE}`;
  const sentence = sageFailureMessage(code, { audience, messageSaved: true, canRetry: false });
  return `${partial}\n\n(Sage got cut off.) ${sentence}`;
}

/** A partial reply as the route saves it: the same, with no Try again wording. */
export function savedCutOffReply(partial: string, code: SageFailureCode, audience: SageFailureAudience): string {
  if (offersRetry(code)) return `${partial}\n\n${SAVED_CUT_OFF_NOTE}`;
  return cutOffReply(partial, code, audience);
}

/** True for a reply that stopped partway, so it does not count as an answer. */
export function isCutOffReply(content: string): boolean {
  return content.includes(CUT_OFF_MARK);
}

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * The HTTP status a local-AI error reports. The relay (scripts/mac-relay)
 * answers 502 with no Mac, 503 at capacity and 504 on timeout; OllamaProvider
 * puts that status in "Local AI ... failed (NNN)", and an Ollama error framed
 * inside a stream reads "Ollama returned NNN".
 */
const REPORTED_STATUS =
  /(?:Ollama returned (\d{3})\b|Local AI (?:tool |structured )?(?:stream|request) failed \((\d{3})\))/i;

const STATUS_CAUSE: ReadonlyMap<number, SageFailureCode> = new Map<number, SageFailureCode>([
  [401, "not_set_up"],
  [403, "not_set_up"],
  [404, "not_set_up"],
  [429, "busy"],
  [502, "off"],
  [503, "busy"],
  [504, "slow"],
  [520, "off"],
  [521, "off"],
  [522, "off"],
  [523, "off"],
  [524, "slow"],
  [530, "off"],
]);

const NOT_SET_UP_TEXT =
  /not configured|is invalid|does not match the approved|cannot serve this demo|Local AI only|No local model/i;
const SLOW_TEXT = /first content token|timed out|timeout|stalled/i;
const OFF_TEXT =
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|getaddrinfo|fetch failed|socket hang up|connection reset|connection unavailable|unreachable|not reachable/i;

function failureText(error: unknown): string {
  if (!(error instanceof Error)) return typeof error === "string" ? error : "";
  const cause = error.cause instanceof Error ? error.cause.message : error.cause;
  return typeof cause === "string" ? `${error.message} ${cause}` : error.message;
}

function causeFromText(text: string): SageFailureCode {
  const match = REPORTED_STATUS.exec(text);
  if (match) return STATUS_CAUSE.get(Number(match[1] ?? match[2])) ?? "unknown";
  if (NOT_SET_UP_TEXT.test(text)) return "not_set_up";
  if (SLOW_TEXT.test(text)) return "slow";
  if (OFF_TEXT.test(text)) return "off";
  return "unknown";
}

/** A failure after the stream opened: the model was called and did not answer. */
export function classifyStreamFailure(error: unknown): SageFailureCode {
  return causeFromText(failureText(error));
}

/** A failure while choosing the model, before anything was sent to it. */
export function classifyProviderInitFailure(error: unknown): SageFailureCode {
  if (error instanceof Error && error.name === "AiCloudRefusedError") return "not_set_up";
  return causeFromText(failureText(error));
}

/** Reads `failure` off an error body or SSE event; null when absent or unknown. */
export function parseSageFailureCode(value: unknown): SageFailureCode | null {
  if (typeof value !== "object" || value === null || !("failure" in value)) return null;
  const code = value.failure;
  return SAGE_FAILURE_CODES.find((known) => known === code) ?? null;
}

// ─── Capture ────────────────────────────────────────────────────────────────

export interface FailureCapture {
  provider: AIProvider;
  /** The last error the provider threw on this turn, or undefined. */
  lastError: () => unknown;
}

/**
 * Remembers what the provider threw, then rethrows it unchanged.
 *
 * The agent loop (src/lib/sage/agent/loop.ts) catches a provider error and
 * reports only `agent_stop { reason: "error" }`, so the route would
 * otherwise never learn whether Sage was off, busy or slow. Nothing about the
 * request or the reply changes.
 */
export function withFailureCapture(provider: AIProvider): FailureCapture {
  let last: unknown;
  async function* remember<T>(stream: AsyncIterable<T>): AsyncGenerator<T> {
    try {
      yield* stream;
    } catch (error) {
      last = error;
      throw error;
    }
  }
  const tools = provider.streamWithTools?.bind(provider);
  const wrapped: AIProvider = {
    name: provider.name,
    generateResponse: (...args) =>
      provider.generateResponse(...args).catch((error: unknown) => {
        last = error;
        throw error;
      }),
    streamResponse: (...args) => remember(provider.streamResponse(...args)),
    generateStructuredResponse: (...args) => provider.generateStructuredResponse(...args),
    ...(tools ? { streamWithTools: (...args: Parameters<typeof tools>) => remember(tools(...args)) } : {}),
    ...(provider.describeDocument ? { describeDocument: provider.describeDocument.bind(provider) } : {}),
  };
  return { provider: wrapped, lastError: () => last };
}
