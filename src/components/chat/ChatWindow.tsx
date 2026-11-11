"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowSquareOut, CheckCircle, Clock, List, WarningCircle, Wrench } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api";
import ChatInput, { type MessageBoxHandle } from "./ChatInput";
import { ActionCard } from "./ActionCard";
import { ConfirmToolCard } from "./ConfirmToolCard";
import ConversationList from "./ConversationList";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import BrandLockup from "@/components/ui/BrandLockup";
import { StarterChips } from "./StarterChips";
import type { ChatRole } from "@/lib/chat/commands";
import { prepareRetry } from "@/lib/chat/send-outcome";
import { readChatStream, formatToolName, type AgentEventItem } from "./chat-stream";
import { FailedReplyActions, PROGRAM_SETUP_HREF } from "./FailedReplyActions";
import { useProgression } from "@/components/progression/ProgressionProvider";
import { STAGE_OPENERS } from "@/lib/chat/stage-openers";
import { determineStage } from "@/lib/sage/stage";
import { startGoalPolling } from "./goal-polling";
import { runExclusive, shouldFocusRetry, type ChatMessage, type FailedTurn } from "./failed-turn";
import { useSendAbort } from "./send-abort";
import { fetchGoalCount, postChatMessage, startOptimisticGreeting } from "./send-request";
import { messagesAfterSendError, turnResultMessages } from "./send-turn";
import { createTurnRecorder, type SentSoFar } from "./turn-recorder";
import { logBusy, showsCannedOpener, startSlowReplyTimer } from "./wait-and-stop";

type Message = ChatMessage;

interface ChatWindowInnerProps {
  role: ChatRole;
  defaultStage?: string;
  /** Sage runs on the local model: no canned opener (wait-and-stop.ts). */
  localProvider: boolean;
}

const REQUESTED_STAGE_OPENERS = {
  discovery: STAGE_OPENERS.discovery,
  career_profile_review: STAGE_OPENERS.career_profile_review,
} as const;

/**
 * Message text from an "Ask Sage" deep link (?prompt=, or ?topic= with ?name=).
 * Anyone can write these URLs, so the text only prefills the input box: the
 * user reads it and presses Send themselves. It is never sent on load (F19).
 */
function buildDeepLinkPrefill(searchParams: Pick<URLSearchParams, "get">): string {
  const prompt = searchParams.get("prompt")?.trim();
  const topic = searchParams.get("topic");
  const name = searchParams.get("name");

  if (prompt) return prompt.slice(0, 1000);
  if (topic === "form" && name) {
    return `Can you tell me about the "${name}" form? What is it for and what do I need to know about it?`;
  }
  if (topic === "cert" && name) {
    return `I'd like to learn about the ${name} certification. What does it involve and how do I get started?`;
  }
  if (topic === "platform" && name) {
    return `Can you help me understand how to use ${name}? How do I get started with it?`;
  }
  if (name) return `I have a question about ${name}.`;
  return "";
}

function metaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function AgentEventList({ events }: { events: AgentEventItem[] }) {
  if (events.length === 0) return null;

  // When an action card is present, hide the matching success tool chip so the
  // student sees one clear next step (Cursor-style) instead of status + link.
  const hasActionCard = events.some(
    (event) =>
      event.kind === "action" &&
      event.target &&
      (event.action === "open_form" ||
        event.action === "open_resource" ||
        event.action === "navigate" ||
        event.action === "confirm_tool"),
  );

  return (
    <div className="ml-11 mt-2 space-y-2">
      {events.map((event) => {
        if (event.kind === "action" && event.action === "confirm_tool" && event.meta) {
          return (
            <ConfirmToolCard
              key={event.id}
              label={event.label || "Confirm"}
              summary={String((event.meta as { summary?: unknown }).summary ?? event.summary)}
              meta={event.meta}
            />
          );
        }
        if (
          event.kind === "action" &&
          event.target &&
          event.action &&
          (event.action === "open_form" ||
            event.action === "open_resource" ||
            event.action === "navigate")
        ) {
          return (
            <ActionCard
              key={event.id}
              action={event.action}
              target={event.target}
              label={event.label || "Open"}
              title={metaString(event.meta, "title")}
              description={metaString(event.meta, "description")}
            />
          );
        }
        if (event.kind === "action" && event.target) {
          // Fallback for unknown action kinds — keep a usable link.
          const external = /^https?:\/\//i.test(event.target);
          const newTab = external || event.action === "open_form";
          return (
            <a
              key={event.id}
              href={event.target}
              target={newTab ? "_blank" : undefined}
              rel={newTab ? "noopener noreferrer" : undefined}
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-[var(--chat-panel-border)] bg-[var(--chat-panel-bg)] px-3 py-2 text-sm font-semibold text-[var(--chat-sage-action)] shadow-sm transition-colors hover:bg-[var(--chat-sage-mark-bg)]"
            >
              <ArrowSquareOut size={17} weight="bold" className="shrink-0" />
              <span className="truncate">{event.label || "Open"}</span>
            </a>
          );
        }

        // Suppress success tool chips when an action card already carries the CTA.
        if (hasActionCard && event.kind === "tool" && event.status === "success") {
          return null;
        }

        const Icon =
          event.status === "success"
            ? CheckCircle
            : event.status === "error"
              ? WarningCircle
              : event.status === "pending"
                ? Clock
                : Wrench;
        const tone =
          event.status === "success"
            ? "border-[var(--badge-success-bg)] bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
            : event.status === "error"
              ? "border-[var(--badge-error-bg)] bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]"
              : "border-[var(--chat-panel-border)] bg-[var(--chat-panel-bg)] text-[var(--ink-muted)]";

        return (
          <div
            key={event.id}
            className={`flex max-w-[34rem] items-start gap-2 rounded-xl border px-3 py-2 text-xs ${tone}`}
          >
            <Icon size={16} weight="bold" className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-[var(--ink-strong)]">
                {formatToolName(event.tool)}
              </p>
              <p className="mt-0.5 leading-5">{event.summary}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChatWindowInner({ role, defaultStage, localProvider }: ChatWindowInnerProps) {
  const searchParams = useSearchParams();
  const requestedStage = searchParams.get("stage");
  const requestedStageOpener =
    requestedStage && Object.prototype.hasOwnProperty.call(REQUESTED_STAGE_OPENERS, requestedStage)
      ? REQUESTED_STAGE_OPENERS[requestedStage as keyof typeof REQUESTED_STAGE_OPENERS]
      : null;
  const { checkProgression } = useProgression();
  // Read once on mount, like the deep-link effect this replaces.
  const [deepLinkPrefill] = useState(() => buildDeepLinkPrefill(searchParams));
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingEvents, setStreamingEvents] = useState<AgentEventItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [goalToast, setGoalToast] = useState<string | null>(null);
  const [failedTurn, setFailedTurn] = useState<FailedTurn | null>(null);
  const [conversationRefreshKey, setConversationRefreshKey] = useState(0);
  /**
   * Optimistic greeting shown immediately on a new conversation before SSE
   * returns the first real token. Cleared when real content arrives or when
   * the user sends a second message before SSE completes.
   */
  const [optimisticGreeting, setOptimisticGreeting] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cancelGoalPollRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);
  const greetingGenerationRef = useRef(0);
  const sidebarRef = useRef<HTMLDivElement>(null);
  /** Tracks whether the warmup fetch has fired this session. */
  const warmupFiredRef = useRef(false);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  /** Set while a Try again is running, so a second tap before re-render does nothing. */
  const retryInFlightRef = useRef(false);
  const messageBoxRef = useRef<MessageBoxHandle>(null);
  /** The answer in flight, so Stop can end it once armed; and whether Stop did. */
  const { gate: sendAbort, isArmed: stopIsArmed } = useSendAbort();
  /** Counts sends, so the wait words belong to one send and reset on the next. */
  const [sendCount, setSendCount] = useState(0);
  const [slowForSend, setSlowForSend] = useState<number | null>(null);
  const waitingForWord = isLoading && !streamingContent;
  const slowReply = waitingForWord && slowForSend === sendCount;

  useEffect(() => {
    mountedRef.current = true;
    // Unmount deliberately does not abort the reply in flight: the server then
    // finishes it and saves the full reply, which shows when the student is back.
    return () => {
      mountedRef.current = false;
      cancelGoalPollRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!goalToast) return;
    const timer = setTimeout(() => setGoalToast(null), 4000);
    return () => clearTimeout(timer);
  }, [goalToast]);

  // The wait words: five seconds with no word from Sage, timed per send and
  // cancelled by the first streamed word.
  useEffect(() => {
    if (!waitingForWord) return;
    const send = sendCount;
    return startSlowReplyTimer(() => setSlowForSend(send));
  }, [waitingForWord, sendCount]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const refreshConversationList = useCallback(() => {
    setConversationRefreshKey((prev) => prev + 1);
  }, []);

  const loadConversationById = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/api/chat/history?conversationId=${id}`);
      if (res.ok) {
        const data = await res.json();
        setConversationId(id);
        setMessages(
          data.messages.map((m: { id: string; role: string; content: string }) => ({
            id: m.id,
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          }))
        );
        setFailedTurn(null);
      }
    } catch (err) {
      console.error("Failed to load conversation:", err instanceof Error ? err.message : "Unknown error");
    }
    setShowSidebar(false);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, streamingEvents, scrollToBottom]);

  useEffect(() => {
    async function loadActiveConversation() {
      if (requestedStageOpener) return;

      try {
        const res = await apiFetch("/api/chat/conversations");
        if (!res.ok) return;
        const data = await res.json();
        const active = data.conversations?.find((c: { active: boolean }) => c.active);
        if (active) {
          await loadConversationById(active.id);
        }
      } catch (err) {
        console.error("Failed to load conversations:", err instanceof Error ? err.message : "Unknown error");
      }
    }

    void loadActiveConversation();
  }, [loadConversationById, requestedStageOpener]);

  /**
   * B1 — Warmup fetch.
   * Fires once on mount when there is no active conversation so the backend
   * can warm the base-context cache before the student sends their first
   * message. Fire-and-forget: errors are silently discarded and we never
   * block render or chat interaction waiting for it.
   *
   * Skipped for non-student roles: the endpoint primes a per-student cache
   * and rejects teacher/admin sessions with 403, so calling it would just
   * generate log noise without warming anything useful.
   */
  useEffect(() => {
    if (warmupFiredRef.current || conversationId) return;
    if (role !== "student") return;
    warmupFiredRef.current = true;
    fetch("/api/chat/warmup", { credentials: "include" }).catch(() => {
      // Intentionally ignored — warmup is best-effort.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Derives the current ConversationStage from the student's goal list.
   * Mirrors the logic in `determineStage()` from system-prompts.ts so
   * the optimistic greeting matches what the backend will compute.
   * Falls back to "discovery" (the most common new-conversation case).
   */
  const deriveStageFromGoals = useCallback(async () => {
    try {
      const res = await apiFetch("/api/goals");
      if (!res.ok) return "discovery" as const;
      const data = await res.json();
      const goals: { level: string }[] = data.goals ?? [];
      return determineStage(goals);
    } catch {
      return "discovery" as const;
    }
  }, []);

  const startNewChat = () => {
    greetingGenerationRef.current++;
    setConversationId(null);
    setMessages([]);
    setStreamingContent("");
    setStreamingEvents([]);
    setFailedTurn(null);
    setOptimisticGreeting(null);
    setShowSidebar(false);
  };

  const pollForGoals = useCallback((prevGoalCount: number) => {
    cancelGoalPollRef.current?.();
    // A chat response may finish after navigation has already unmounted us.
    if (!mountedRef.current) return;
    cancelGoalPollRef.current = startGoalPolling(prevGoalCount, (level) => {
      const levelLabels: Record<string, string> = {
        bhag: "Big Hairy Audacious Goal",
        monthly: "Monthly Goal",
        weekly: "Weekly Goal",
        daily: "Daily Goal",
        task: "Action Task",
      };
      setGoalToast(`${levelLabels[level] || level} captured!`);
    });
  }, []);

  /** The screen at the start of a send: the student's bubble, the dots, and the opener. */
  const beginTurnDisplay = useCallback((text: string, isRetry: boolean) => {
    // A Try again from an earlier turn never stays on screen past a new send.
    setFailedTurn(null);
    // B2: loading shows at once, before any network call. A Try again
    // answers the message already on screen, so it adds no new bubble.
    if (!isRetry) setMessages((prev) => [...prev, { id: `temp-${Date.now()}`, role: "user", content: text }]);
    setIsLoading(true);
    setSendCount((count) => count + 1);
    setStreamingContent("");
    setStreamingEvents([]);
    const greetingGeneration = ++greetingGenerationRef.current;
    const isFirstMessage = !conversationId && messages.length === 0;
    if (showsCannedOpener({ role, isFirstMessage, localProvider })) {
      const isCurrent = () => greetingGenerationRef.current === greetingGeneration;
      startOptimisticGreeting({ opener: requestedStageOpener, deriveStage: deriveStageFromGoals, isCurrent, show: setOptimisticGreeting });
    }
  }, [conversationId, messages.length, role, localProvider, requestedStageOpener, deriveStageFromGoals]);

  /**
   * Sets the conversation a send's events name, and refreshes the list once
   * when a new chat gets its id. One noter per send.
   */
  const makeConversationNoter = useCallback(() => {
    let refreshedList = false;
    return (nextId: string | undefined) => {
      setConversationId(nextId ?? conversationId);
      if (refreshedList || !nextId || nextId === conversationId) return;
      refreshConversationList();
      refreshedList = true;
    };
  }, [conversationId, refreshConversationList]);

  /** B4: hides the canned opener, and stops a pending one from appearing. */
  const clearOptimisticGreeting = useCallback(() => {
    greetingGenerationRef.current++;
    setOptimisticGreeting(null);
  }, []);

  /** The screen once a send is over, whatever happened. */
  const endTurnDisplay = useCallback(() => {
    setIsLoading(false);
    // A failure mid-reply moved the partial text into `messages`, so nothing
    // may stay drawn as still streaming below it.
    setStreamingContent("");
    setStreamingEvents([]);
    // B4: the optimistic greeting never outlives the send, error paths included.
    clearOptimisticGreeting();
  }, [clearOptimisticGreeting]);

  /** A finished turn's bubbles, and its Try again when the reply came back empty or cut off. */
  const showTurnResult = useCallback((shown: { messages: ChatMessage[]; failedTurn: FailedTurn | null }) => {
    setMessages((prev) => [...prev, ...shown.messages]);
    if (shown.failedTurn) setFailedTurn(shown.failedTurn);
  }, []);

  /**
   * What a Stop or a failure leaves on screen: the partial, the 988 help when
   * the first event flagged it, and Try again when it applies.
   */
  const showSendFailure = useCallback(
    (err: unknown, sent: SentSoFar, noteConversation: (nextId: string | undefined) => void) => {
      const stopped = sendAbort.wasStopped();
      if (!stopped) console.error("Send error:", err instanceof Error ? err.name : "Unknown error");
      const after = messagesAfterSendError({
        err,
        stopped,
        ...sent,
        role,
        id: `${stopped ? "stop" : "err"}-${Date.now()}`,
      });
      // A new chat's first message may be saved before the failure: keep its conversation for Try again.
      if (after.conversationId) noteConversation(after.conversationId);
      showTurnResult(after);
    },
    [role, sendAbort, showTurnResult]
  );

  const handleSend = useCallback(
    async (text: string, attachmentIds?: string[], retry?: { retryOf: string | null }) => {
      beginTurnDisplay(text, Boolean(retry));
      const prevGoalCountPromise = fetchGoalCount();
      const noteConversation = makeConversationNoter();
      // Outside the try, so the catch knows what streamed in before a Stop or failure.
      const turn = createTurnRecorder({
        noteIds: sendAbort.noteIds,
        noteConversation,
        onFirstText: clearOptimisticGreeting,
        showText: setStreamingContent,
        showEvents: setStreamingEvents,
      });
      const controller = sendAbort.begin();
      try {
        const res = await postChatMessage({
          text,
          conversationId,
          stage: searchParams.get("stage") ?? defaultStage,
          attachmentIds,
          retryOf: retry?.retryOf,
          signal: controller.signal,
        });
        const result = await readChatStream(res, turn.handlers);
        const { savedUserMessageId, crisisBlock } = turn.sent();
        showTurnResult(turnResultMessages({ result, id: `msg-${Date.now()}`, savedUserMessageId, crisisBlock }));
        pollForGoals(await prevGoalCountPromise);
        setTimeout(() => checkProgression(), 2000); // XP, achievement and level changes
      } catch (err) {
        showSendFailure(err, turn.sent(), noteConversation);
      } finally {
        sendAbort.end(controller);
        endTurnDisplay();
      }
    },
    [
      conversationId,
      pollForGoals,
      checkProgression,
      searchParams,
      defaultStage,
      sendAbort,
      beginTurnDisplay,
      endTurnDisplay,
      clearOptimisticGreeting,
      makeConversationNoter,
      showTurnResult,
      showSendFailure,
    ]
  );

  // After a failed turn, focus goes to its Try again once loading has ended,
  // after ChatInput's own effect focuses the message box (rule in failed-turn.ts).
  useEffect(() => {
    if (shouldFocusRetry(failedTurn, isLoading)) retryButtonRef.current?.focus();
  }, [failedTurn, isLoading]);

  /** Ends Sage's answer once armed; handleSend's catch shows what a Stop leaves. */
  const stopReply = sendAbort.stop;

  const retryFailedTurn = (failedId: string) =>
    runExclusive(retryInFlightRef, async () => {
      const retry = prepareRetry(messages, failedId);
      if (!retry) return;
      // Before the button goes away, so focus never falls to the page.
      messageBoxRef.current?.focus();
      setMessages(retry.messages);
      await handleSend(retry.text, undefined, { retryOf: retry.retryOf });
    });

  useEffect(() => {
    if (!showSidebar) return;

    const focusSidebar = () => {
      sidebarRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowSidebar(false);
      }
    };

    requestAnimationFrame(focusSidebar);
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showSidebar]);

  return (
    <div className="relative flex min-h-[70dvh] overflow-hidden rounded-2xl border border-[var(--chat-panel-border)] bg-[var(--chat-area-bg)] md:h-[72vh] md:min-h-[42rem]">
      <div
        ref={sidebarRef}
        id="sage-conversations"
        className={`absolute z-40 h-full w-[min(17.5rem,calc(100vw-1.5rem))] transition-transform md:relative md:w-[17.5rem]
          ${showSidebar ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <ConversationList
          onSelect={loadConversationById}
          onNewChat={startNewChat}
          onDelete={(deletedId) => {
            if (deletedId === conversationId) {
              startNewChat();
            }
          }}
          activeId={conversationId}
          refreshKey={conversationRefreshKey}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-[var(--chat-area-bg)]">
        <div className="flex items-center gap-3 border-b border-[var(--chat-panel-border)] bg-[var(--chat-header-bg)] px-4 py-2.5 backdrop-blur">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            type="button"
            aria-label={showSidebar ? "Hide conversations" : "Show conversations"}
            aria-controls="sage-conversations"
            aria-expanded={showSidebar}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--chat-panel-border)] text-[var(--ink-muted)] hover:bg-[var(--chat-sidebar-hover)] hover:text-[var(--ink-strong)] md:hidden"
          >
            <List aria-hidden="true" size={20} weight="bold" />
          </button>
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--chat-sage-mark-bg)] text-xs font-bold text-[var(--chat-sage-mark)]"
            aria-hidden="true"
          >
            S
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ink-strong)]">Sage</p>
            <p className="text-xs text-[var(--ink-muted)]">Your SPOKES coach</p>
          </div>
          <Link
            href="/about-sage"
            className="ml-auto inline-flex min-h-11 items-center px-2 text-sm font-semibold text-[var(--ink-muted)] underline hover:text-[var(--ink-strong)]"
          >
            About Sage
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5" role="log" aria-label="Conversation with Sage" aria-live="polite" aria-busy={logBusy(isLoading, streamingContent)}>
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.length === 0 && !isLoading && (
              <div className="mt-16 text-center text-[var(--ink-muted)]">
                <div className="mx-auto mb-5 flex justify-center">
                  <BrandLockup
                    size="md"
                    title="VisionQuest"
                    subtitle="SPOKES Workforce Development"
                    align="center"
                  />
                </div>
                <p className="font-display text-3xl text-[var(--ink-strong)] sm:text-4xl">Chat with Sage</p>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6">
                  Ask about goals, forms, next steps, or what feels stuck — Sage stays with you in this chat.
                </p>
                <div className="mt-8">
                  <StarterChips role={role} onSelect={(prefill) => handleSend(prefill)} />
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id}>
                <MessageBubble
                  role={msg.role}
                  content={msg.content}
                  failed={msg.failure?.alert}
                  textId={failedTurn?.messageId === msg.id ? `failed-text-${msg.id}` : undefined}
                />
                {msg.events?.length ? <AgentEventList events={msg.events} /> : null}
                {failedTurn?.messageId === msg.id && (
                  <FailedReplyActions
                    retryRef={retryButtonRef}
                    offerRetry={failedTurn.offerRetry}
                    setupHref={failedTurn.setupLink ? PROGRAM_SETUP_HREF : null}
                    describedById={`failed-text-${msg.id}`}
                    onRetry={() => void retryFailedTurn(msg.id)}
                  />
                )}
              </div>
            ))}

            {/* B4: Optimistic greeting — visible from send until first SSE text chunk */}
            {optimisticGreeting && !streamingContent && (
              <div>
                <MessageBubble role="assistant" content={optimisticGreeting} isStreaming />
                <p className="ml-11 mt-1 text-xs text-[var(--ink-muted)]">sending…</p>
              </div>
            )}

            {streamingContent && (
              <div>
                <MessageBubble role="assistant" content={streamingContent} isStreaming />
                <AgentEventList events={streamingEvents} />
              </div>
            )}

            {!streamingContent && streamingEvents.length > 0 && (
              <AgentEventList events={streamingEvents} />
            )}

            {isLoading && !streamingContent && !optimisticGreeting && <TypingIndicator slow={slowReply} />}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {goalToast && (
          <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2" role="alert">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--toast-celebration-border)] bg-[var(--toast-celebration-bg)] px-4 py-2 text-sm font-semibold text-[var(--toast-celebration-text)] shadow-sm">
              <CheckCircle size={16} weight="bold" aria-hidden="true" />
              <span>{goalToast} · +50 XP</span>
            </div>
          </div>
        )}

        <ChatInput
          onSend={handleSend}
          onStop={stopReply}
          stopArmed={stopIsArmed}
          disabled={isLoading}
          role={role}
          initialMessage={deepLinkPrefill}
          messageBoxRef={messageBoxRef}
        />
      </div>

      {showSidebar && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/30"
          onClick={() => setShowSidebar(false)}
        />
      )}
    </div>
  );
}

interface ChatWindowProps {
  role?: ChatRole;
  defaultStage?: string;
  /** From the server: Sage runs on the local model. Default false keeps today's opener. */
  localProvider?: boolean;
}

export default function ChatWindow({ role = "student", defaultStage, localProvider = false }: ChatWindowProps = {}) {
  return (
    <Suspense>
      <ChatWindowInner role={role} defaultStage={defaultStage} localProvider={localProvider} />
    </Suspense>
  );
}
