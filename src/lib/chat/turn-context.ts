/**
 * Everything a Sage chat turn loads before the model call: staff student
 * context, the student's program, the system prompt and its retrieval,
 * memory and attachment blocks, and the transcript window.
 *
 * Moved out of `src/app/api/chat/send/route.ts` for E7: the route now sends
 * the stream's first event (ids and crisisHelp) before any of this runs, so a
 * slow or stalled load can no longer leave Stop inert and the message box
 * locked. The order of the loads is unchanged, so the queries a turn issues
 * before the model call are the same (src/lib/readiness/chat-send-query-count.test.ts).
 */

import type { getPromptTier } from "@/lib/ai";
import type { getProviderClass } from "@/lib/ai/audit";
import type { AIProvider, ChatMessage } from "@/lib/ai/types";
import { usesMacPromptCache } from "@/lib/ai/local-model";
import type { Session } from "@/lib/api-error";
import { formatAttachmentContext } from "@/lib/chat/attachment-context";
import { COMPACT_HISTORY_TOKEN_BUDGET, FULL_HISTORY_TOKEN_BUDGET, getConversationContext } from "@/lib/chat/conversation";
import { loadOpenOrientationItems } from "@/lib/chat/open-orientation-items";
import type { ChatSendBody } from "@/lib/chat/retry-turn";
import { studentVisibleAlerts } from "@/lib/chat/student-visible-alerts";
import { transcriptWindowFor } from "@/lib/chat/transcript-window";
import { prisma } from "@/lib/db";
import { estimateTokens } from "@/lib/llm-usage-estimate";
import { logger } from "@/lib/logger";
import type { ProgramType } from "@/lib/program-type";
import { getStudentProgramType } from "@/lib/program-type-server";
import { assembleStudentContextBundle, selfMetricLineFromBundle } from "@/lib/sage/context-bundle";
import { getDocumentContext } from "@/lib/sage/knowledge-base-server";
import { getFormContext } from "@/lib/sage/knowledge-base";
import { getStudentProfile } from "@/lib/sage/memory/profile";
import { getMemoryContext, getStaffMemoryContext } from "@/lib/sage/memory/retrieve";
import { renderRecentActivity } from "@/lib/sage/recent-activity";
import { getSituationalSnapshot } from "@/lib/sage/situational-snapshot";
import type { staffChatStageFor } from "@/lib/sage/staff-chat-stage";
import { buildStaffStudentContext, shouldAttemptStaffStudentContext } from "@/lib/sage/staff-student-context";
import { buildCacheableSystemPrompt, buildSystemPrompt, type ConversationStage } from "@/lib/sage/system-prompts";
import { formatClustersForPrompt } from "@/lib/spokes/career-clusters";

type PromptTier = ReturnType<typeof getPromptTier>;
type StaffChatStage = NonNullable<ReturnType<typeof staffChatStageFor>>;
export type StaffContextResolution = "none" | "resolved" | "ambiguous" | "not_found";

export interface TurnContextInput {
  session: Session;
  body: ChatSendBody;
  userMessage: string;
  conversation: { id: string; messages?: ReadonlyArray<{ role: string; content: string }> };
  /** The stored stage, and the per-turn prompt stage the route chose. */
  conversationStage: ConversationStage;
  promptStage: ConversationStage;
  staffChatStage: StaffChatStage | null;
  isTeacher: boolean;
  isAdmin: boolean;
  provider: AIProvider;
  promptTier: PromptTier;
  providerClass: ReturnType<typeof getProviderClass>;
  /** The per-account daily cap and what is left of it, when one applies. */
  daily: { remaining: number; limit: number } | null;
}

export interface TurnContext {
  systemPrompt: string;
  systemPrefixLength: number | undefined;
  allMessages: ChatMessage[];
  staffStudentTargetId: string | null;
  staffStudentContextResolution: StaffContextResolution;
  studentProgramType: ProgramType | null;
  studentClassroomConfirmedAt: Date | null;
  turnHasAttachment: boolean;
}

/** The system prompt as it grows, with each block's size for sage.prompt.size. */
interface PromptBuild {
  text: string;
  sections: Readonly<Record<string, number>>;
}

function appendBlock(build: PromptBuild, key: string, text: string, size = text.length): PromptBuild {
  return { text: build.text + text, sections: { ...build.sections, [key]: size } };
}

const TRIVIAL_PATTERN = /^(hi|hello|hey|yo|sup|thanks?|thank you|thx|ty|ok|okay|k|cool|nice|great|got it|sure|yes|no|yep|nope|yeah|nah|yup|hm|hmm|wow|oh|ah|lol|haha|bye|goodbye|cya)[!.,?]*$/i;

/**
 * Detects messages that don't benefit from RAG retrieval — short pleasantries,
 * acknowledgements, single-word replies. Skipping RAG on these saves the
 * embedding lookup + ~6,000 chars of prompt bloat + ~200-300ms first-token delay.
 */
export function isTrivialMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length <= 4) return true;
  if (TRIVIAL_PATTERN.test(trimmed)) return true;
  // Short messages with no question words are usually continuations of
  // prior context; Sage's history covers them.
  const tokens = trimmed.split(/\s+/);
  if (tokens.length <= 3 && !/[?]/.test(trimmed)) return true;
  return tokens.length <= 2;
}

/**
 * Staff context for a teacher turn that names or targets a student.
 * Coordinators never get it: it resolves students through teacher-scoped
 * RLS, and coordinator chat stays regional (coordinator_assistant prompt).
 */
async function loadStaffStudentContext(input: TurnContextInput) {
  const { session, body, userMessage, isTeacher, isAdmin } = input;
  const resolution: StaffContextResolution = "none";
  const none = { context: null, targetStudentId: null, resolution };
  if (!isTeacher) return none;
  const priorUserMessages = (input.conversation.messages ?? [])
    .filter((message) => message.role === "user")
    .map((message) => message.content);
  const attempt =
    Boolean(body.targetStudentId) || (!isAdmin && shouldAttemptStaffStudentContext(userMessage, priorUserMessages));
  if (!attempt) return none;
  return buildStaffStudentContext(session, { userMessage, priorUserMessages, targetStudentId: body.targetStudentId });
}

/** Program context for a student, reused by the prompt and the post-response handler. */
async function loadStudentProgram(studentId: string, isStaffChat: boolean) {
  if (isStaffChat) return { programType: null, classroomConfirmedAt: null };
  const [programType, studentRecord] = await Promise.all([
    getStudentProgramType(studentId),
    prisma.student.findUnique({ where: { id: studentId }, select: { classroomConfirmedAt: true } }),
  ]);
  return { programType, classroomConfirmedAt: studentRecord?.classroomConfirmedAt ?? null };
}

interface BasePrompt {
  text: string;
  systemPrefixLength: number | undefined;
  recentActivity: string;
}

/** buildSystemPrompt, or the cacheable form with its prefix boundary on the Mac prompt cache. */
function buildTurnPrompt(...args: Parameters<typeof buildSystemPrompt>): { text: string; systemPrefixLength: number | undefined } {
  if (!usesMacPromptCache()) return { text: buildSystemPrompt(...args), systemPrefixLength: undefined };
  return buildCacheableSystemPrompt(...args);
}

async function buildStudentPrompt(
  input: TurnContextInput,
  program: { programType: ProgramType | null; classroomConfirmedAt: Date | null },
): Promise<BasePrompt> {
  const { session, conversation, conversationStage, promptStage, promptTier, userMessage } = input;
  // The bundle is the single entry point for Sage student chat.
  const bundle = await assembleStudentContextBundle(session.id, {
    viewer: "sage",
    conversationId: conversation.id,
    conversationStage,
    includeChatPromptContext: true,
    priorSummaryLimit: promptTier === "compact" ? 1 : 3,
  });
  const ctx = bundle.chatPromptContext;
  if (!ctx) throw new Error("assembleStudentContextBundle returned no chatPromptContext despite includeChatPromptContext");
  // Skipped for the first-meeting discovery stage and the compact tier.
  const situationalSnapshot =
    conversationStage !== "discovery" && promptTier !== "compact"
      ? (await getSituationalSnapshot(session.id)) ?? undefined
      : undefined;
  const built = buildTurnPrompt(promptStage, {
    studentName: session.displayName,
    programType: program.programType,
    classroomConfirmedAt: program.classroomConfirmedAt,
    situationalSnapshot,
    bhag: ctx.goalsByLevel["bhag"],
    monthly: ctx.goalsByLevel["monthly"],
    weekly: ctx.goalsByLevel["weekly"],
    daily: ctx.goalsByLevel["daily"],
    goals_summary: ctx.goalsSummary,
    student_status_summary: ctx.studentStatusSummary,
    userMessage,
    career_clusters: promptStage === "discovery" ? formatClustersForPrompt() : undefined,
    discovery_summary: ctx.discoverySummary,
    career_profile_context: ctx.careerProfileContext,
    skillGapContext: ctx.skillGapContext,
    pathwayContext: ctx.pathwayContext,
    coachingArcContext: ctx.coachingArcContext,
    selfMetricsLine: selfMetricLineFromBundle(bundle),
  }, promptTier);
  const text = built.systemPrefixLength === undefined
    ? ctx.priorConversationContext + built.text
    : built.text + ctx.priorConversationContext;
  // Recent activity: bounded by construction, so kept on the compact tier too.
  const recentActivity = conversationStage !== "discovery"
    ? renderRecentActivity({ events: bundle.recentEvents, alerts: studentVisibleAlerts(bundle.alerts) })
    : "";
  return { text, systemPrefixLength: built.systemPrefixLength, recentActivity };
}

/** RAG, form context and durable memory, each in its own section. */
async function appendRetrieval(build: PromptBuild, input: TurnContextInput): Promise<PromptBuild> {
  const { session, userMessage, promptTier } = input;
  const isStaffChat = input.staffChatStage !== null;
  const memoryEnabled = process.env.SAGE_MEMORY_ENABLED?.trim().toLowerCase() !== "false";
  const [documentContext, formContext, memoryData] = await Promise.all([
    // Attribution for the query embedding's LlmCallLog row and audit event
    // (FERPA review W5). Staff chat has no student subject here.
    getDocumentContext(userMessage, isStaffChat ? "staff" : "student", 3, promptTier === "compact" ? 2000 : 6000, {
      studentId: isStaffChat ? null : session.id,
    }),
    Promise.resolve(getFormContext(userMessage)),
    memoryEnabled ? loadMemory(session.id, userMessage, isStaffChat) : Promise.resolve(null),
  ]);
  let next = build;
  if (documentContext) next = appendBlock(next, "docRag", documentContext);
  if (formContext) next = appendBlock(next, "form", formContext);
  if (memoryData?.type === "staff" && memoryData.staffMemory) {
    next = appendBlock(next, "memoryStaffRecall", memoryData.staffMemory);
  } else if (memoryData?.type === "student") {
    const { profile, memoryContext } = memoryData;
    if (profile.block) next = appendBlock(next, "memoryProfile", `\n\n${profile.block}`, profile.block.length);
    if (memoryContext) next = appendBlock(next, "memoryRecall", memoryContext);
  }
  return next;
}

/**
 * Two audiences, strictly separated (memory/retrieve.ts enforces the pairing):
 * a student turn reads only student-subject memories, a staff turn only that
 * staff member's own.
 */
async function loadMemory(viewerId: string, userMessage: string, isStaffChat: boolean) {
  if (isStaffChat) return { type: "staff" as const, staffMemory: await getStaffMemoryContext(viewerId, userMessage) };
  const profile = await getStudentProfile(viewerId);
  const memoryContext = await getMemoryContext(viewerId, userMessage, undefined, profile.contents);
  return { type: "student" as const, profile, memoryContext };
}

/** Attached files the viewer owns, wrapped as untrusted reference data. */
async function appendAttachments(build: PromptBuild, input: TurnContextInput): Promise<{ build: PromptBuild; hasAttachment: boolean }> {
  const ids = input.body.attachmentIds;
  if (!ids || ids.length === 0) return { build, hasAttachment: false };
  const files = await prisma.fileUpload.findMany({
    where: { id: { in: ids }, studentId: input.session.id },
    select: { id: true, filename: true, gist: true },
  });
  if (files.length === 0) return { build, hasAttachment: false };
  // A student's signed form is filed with submit_form, which needs the item id.
  const openOrientationItems = input.staffChatStage !== null ? [] : await loadOpenOrientationItems(input.session.id);
  return { build: appendBlock(build, "attachments", formatAttachmentContext({ files, openOrientationItems })), hasAttachment: true };
}

/** The 80% daily warning, so Sage mentions it naturally. */
function dailyWarningBlock(daily: TurnContextInput["daily"]): string | null {
  if (!daily) return null;
  const usagePercent = 1 - daily.remaining / daily.limit;
  if (usagePercent < 0.8) return null;
  return `\n\n[SYSTEM NOTE: This user has used ${Math.round(usagePercent * 100)}% of their daily message limit. Naturally mention that you're getting a lot of questions today and your answers may be shorter for a bit. Do not make it alarming.]`;
}

/**
 * The window normally already ends with the saved user message; append it
 * only when it does not (another send landed in between), so the model reads
 * it once. A Try again after a saved partial reads question, partial, question.
 */
function withUserMessage(messages: ChatMessage[], userMessage: string): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role === "user" && last.content === userMessage) return messages;
  return [...messages, { role: "user", content: userMessage }];
}

async function basePromptFor(input: TurnContextInput, program: Awaited<ReturnType<typeof loadStudentProgram>>, staffContext: string | null): Promise<BasePrompt> {
  if (!input.staffChatStage) return buildStudentPrompt(input, program);
  const built = buildTurnPrompt(input.staffChatStage, {
    studentName: input.session.displayName,
    userMessage: input.userMessage,
    staffStudentContext: staffContext,
    staffRole: input.session.role,
  }, input.promptTier);
  return { ...built, recentActivity: "" };
}

export async function assembleTurnContext(input: TurnContextInput): Promise<TurnContext> {
  const { session, conversation, conversationStage, promptTier, userMessage } = input;
  const staff = await loadStaffStudentContext(input);
  const program = await loadStudentProgram(session.id, input.staffChatStage !== null);
  const base = await basePromptFor(input, program, staff.context);
  let build: PromptBuild = { text: base.text, sections: { systemBase: base.text.length } };
  if (base.recentActivity) build = appendBlock(build, "recentActivity", `\n\n${base.recentActivity}`);
  // History loads in parallel with retrieval. The transcript window is by
  // provider class: the cloud number is a disclosure decision (transcript-window.ts).
  const historyPromise = getConversationContext(
    conversation.id,
    transcriptWindowFor({ providerClass: input.providerClass, stage: conversationStage }),
    promptTier === "compact" ? COMPACT_HISTORY_TOKEN_BUDGET : FULL_HISTORY_TOKEN_BUDGET,
  );
  // Marked handled so a retrieval throw first cannot leave it unhandled (that
  // ends the process); its own failure still surfaces at the await below.
  void historyPromise.catch(() => undefined);
  const trivial = isTrivialMessage(userMessage);
  if (!trivial) build = await appendRetrieval(build, input);
  const attached = await appendAttachments(build, input);
  build = attached.build;
  const warning = dailyWarningBlock(input.daily);
  if (warning) build = appendBlock(build, "dailyWarning", warning);
  logPromptSize(build, input, trivial);
  const history = await historyPromise;
  return {
    systemPrompt: build.text,
    systemPrefixLength: base.systemPrefixLength,
    allMessages: withUserMessage(history.messages, userMessage),
    staffStudentTargetId: staff.targetStudentId,
    staffStudentContextResolution: staff.resolution,
    studentProgramType: program.programType,
    studentClassroomConfirmedAt: program.classroomConfirmedAt,
    turnHasAttachment: attached.hasAttachment,
  };
}

/** Assembled prompt size, for before/after comparison in Render logs. */
function logPromptSize(build: PromptBuild, input: TurnContextInput, ragSkipped: boolean): void {
  logger.info("sage.prompt.size", {
    size: build.text.length,
    promptTier: input.promptTier,
    provider: input.provider.name,
    stage: input.conversationStage,
    role: input.session.role,
    ragSkipped,
    documentContextChars: build.sections.docRag ?? 0,
    formContextChars: build.sections.form ?? 0,
    sections: build.sections,
    estInputTokens: estimateTokens(build.text.length),
  });
}
