"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowSquareOut, CheckCircle, Clock, List, WarningCircle, Wrench } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api";
import ChatInput from "./ChatInput";
import { ActionCard } from "./ActionCard";
import { ConfirmToolCard } from "./ConfirmToolCard";
import ConversationList from "./ConversationList";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import BrandLockup from "@/components/ui/BrandLockup";
import { StarterChips } from "./StarterChips";
import type { ChatRole } from "@/lib/chat/commands";
import { parseChatSseChunk, type ChatSseEvent } from "@/lib/chat/sse";
import { useProgression } from "@/components/progression/ProgressionProvider";
import { STAGE_OPENERS } from "@/lib/chat/stage-openers";
import { determineStage } from "@/lib/sage/stage";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  events?: AgentEventItem[];
}

interface AgentEventItem {
  id: string;
  kind: "tool" | "action";
  callId?: string;
  tool?: string;
  status?: "pending" | "success" | "error";
  summary: string;
  action?: ChatSseEvent["action"];
  target?: string;
  label?: string;
  meta?: Record<string, unknown>;
}

async function getErrorMessage(res: Response) {
  try {
    const data = await res.json();
    return data.error || "Failed to send message.";
  } catch {
    return "Failed to send message.";
  }
}

interface ChatWindowInnerProps {
  role: ChatRole;
  defaultStage?: string;
}

const REQUESTED_STAGE_OPENERS = {
  discovery: STAGE_OPENERS.discovery,
  career_profile_review: STAGE_OPENERS.career_profile_review,
} as const;

function formatToolName(tool: string | undefined): string {
  if (!tool) return "Sage tool";
  return tool
    .replace(/^sage\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function upsertAgentEvent(events: AgentEventItem[], next: AgentEventItem) {
  const existingIndex = next.callId
    ? events.findIndex((event) => event.callId === next.callId && event.kind === next.kind)
    : -1;
  if (existingIndex >= 0) {
    events[existingIndex] = { ...events[existingIndex], ...next };
  } else {
    events.push(next);
  }
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
              className="inline-flex max-w-full items-center gap-2 rounded-xl border border-[var(--chat-panel-border)] bg-[var(--chat-panel-bg)] px-3 py-2 text-sm font-semibold text-[var(--chat-sage-action)] shadow-sm transition-colors hover:bg-[var(--chat-sage-mark-bg)]"
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

function ChatWindowInner({ role, defaultStage }: ChatWindowInnerProps) {
  const searchParams = useSearchParams();
  const requestedStage = searchParams.get("stage");
  const requestedStageOpener =
    requestedStage && Object.prototype.hasOwnProperty.call(REQUESTED_STAGE_OPENERS, requestedStage)
      ? REQUESTED_STAGE_OPENERS[requestedStage as keyof typeof REQUESTED_STAGE_OPENERS]
      : null;
  const { checkProgression } = useProgression();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingEvents, setStreamingEvents] = useState<AgentEventItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [goalToast, setGoalToast] = useState<string | null>(null);
  const [incompleteMessageId, setIncompleteMessageId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [conversationRefreshKey, setConversationRefreshKey] = useState(0);
  /**
   * Optimistic greeting shown immediately on a new conversation before SSE
   * returns the first real token. Cleared when real content arrives or when
   * the user sends a second message before SSE completes.
   */
  const [optimisticGreeting, setOptimisticGreeting] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestPollIdRef = useRef(0);
  const greetingGenerationRef = useRef(0);
  const sidebarRef = useRef<HTMLDivElement>(null);
  /** Tracks whether the warmup fetch has fired this session. */
  const warmupFiredRef = useRef(false);

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
        setChatError(null);
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
    setIncompleteMessageId(null);
    setChatError(null);
    setOptimisticGreeting(null);
    setShowSidebar(false);
  };

  const pollForGoals = useCallback((prevGoalCount: number) => {
    const pollId = ++latestPollIdRef.current;
    let attempts = 0;
    const interval = setInterval(async () => {
      if (latestPollIdRef.current !== pollId) {
        clearInterval(interval);
        return;
      }

      attempts++;
      if (attempts > 5) {
        clearInterval(interval);
        return;
      }

      try {
        const res = await apiFetch("/api/goals");
        if (!res.ok) return;

        if (latestPollIdRef.current !== pollId) {
          clearInterval(interval);
          return;
        }

        const data = await res.json();
        if (data.goals.length > prevGoalCount) {
          const newGoal = data.goals[data.goals.length - 1];
          const levelLabels: Record<string, string> = {
            bhag: "Big Hairy Audacious Goal",
            monthly: "Monthly Goal",
            weekly: "Weekly Goal",
            daily: "Daily Goal",
            task: "Action Task",
          };
          setGoalToast(`${levelLabels[newGoal.level] || newGoal.level} captured!`);
          setTimeout(() => setGoalToast(null), 4000);
          clearInterval(interval);
        }
      } catch {
        // Ignore polling errors.
      }
    }, 3000);
  }, []);

  const handleSend = useCallback(
    async (text: string, attachmentIds?: string[]) => {
      setChatError(null);

      // B2: Hoist the loading state so the TypingIndicator renders immediately
      // on send, before the goals pre-fetch or any network call.
      const userMsg: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setStreamingContent("");
      setStreamingEvents([]);
      const greetingGeneration = ++greetingGenerationRef.current;

      // B4: If this is the first message of a new conversation (no conversationId
      // and no prior messages), show an optimistic greeting immediately while SSE
      // is in flight. Discard it if the user sends a second message before SSE
      // arrives (handled by checking messages.length in the SSE reader below).
      const isFirstMessage = !conversationId && messages.length === 0;
      if (isFirstMessage) {
        if (requestedStageOpener) {
          setOptimisticGreeting(requestedStageOpener);
        } else {
          // Derive stage asynchronously — don't await here so rendering isn't blocked.
          // The greeting will appear as soon as the stage resolves (typically <200ms).
          void deriveStageFromGoals().then((stage) => {
            if (greetingGenerationRef.current === greetingGeneration) {
              setOptimisticGreeting(STAGE_OPENERS[stage]);
            }
          });
        }
      }

      const prevGoalCountPromise = apiFetch("/api/goals")
        .then(async (goalsRes) => {
          if (!goalsRes.ok) return 0;
          const goalsData = await goalsRes.json();
          return Array.isArray(goalsData.goals) ? goalsData.goals.length : 0;
        })
        .catch(() => 0);

      try {
        const stageParam = searchParams.get("stage") ?? defaultStage;
        const res = await apiFetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            conversationId,
            // Only send on the first message of a new conversation
            requestedStage: conversationId ? undefined : stageParam,
            attachmentIds: attachmentIds && attachmentIds.length > 0 ? attachmentIds : undefined,
          }),
        });

        if (!res.ok) {
          throw new Error(await getErrorMessage(res));
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        let streamCompleted = false;
        let refreshedConversationList = false;
        let sseBuffer = "";
        const agentEvents: AgentEventItem[] = [];

        const maybeRefreshConversations = (nextId?: string) => {
          if (!refreshedConversationList && nextId && nextId !== conversationId) {
            refreshConversationList();
            refreshedConversationList = true;
          }
        };

        const applyStreamEvent = (data: ChatSseEvent) => {
          if (data.error) throw new Error(data.error);
          if (data.conversationId && !data.done) {
            setConversationId(data.conversationId);
            maybeRefreshConversations(data.conversationId);
          }
          if (data.text) {
            // B4: First real token clears the optimistic greeting.
            if (!fullContent) {
              greetingGenerationRef.current++;
              setOptimisticGreeting(null);
            }
            fullContent += data.text;
            setStreamingContent(fullContent);
          }
          if (data.type === "tool_call") {
            upsertAgentEvent(agentEvents, {
              id: data.callId ?? `tool-${agentEvents.length}`,
              kind: "tool",
              callId: data.callId,
              tool: data.tool,
              status: "pending",
              summary: `Checking ${formatToolName(data.tool).toLowerCase()}...`,
            });
            setStreamingEvents([...agentEvents]);
          }
          if (data.type === "tool_result") {
            upsertAgentEvent(agentEvents, {
              id: data.callId ?? `tool-${agentEvents.length}`,
              kind: "tool",
              callId: data.callId,
              tool: agentEvents.find((event) => event.callId === data.callId)?.tool,
              status: data.status,
              summary: data.summary || "Sage finished checking this.",
            });
            setStreamingEvents([...agentEvents]);
          }
          if (data.type === "action") {
            agentEvents.push({
              id: `action-${data.callId ?? agentEvents.length}-${data.target ?? data.label ?? "open"}`,
              kind: "action",
              action: data.action,
              target: data.target,
              label: data.label,
              meta: data.meta,
              summary: data.label || "Open",
            });
            setStreamingEvents([...agentEvents]);
          }
          if (data.done) {
            setConversationId(data.conversationId ?? conversationId);
            maybeRefreshConversations(data.conversationId);
            streamCompleted = true;
          }
        };

        if (!reader) {
          throw new Error("Sage returned no response stream. Please try again.");
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const parsed = parseChatSseChunk(chunk, sseBuffer);
          sseBuffer = parsed.buffer;
          for (const data of parsed.events) {
            applyStreamEvent(data);
          }
        }

        const finalChunk = decoder.decode();
        if (finalChunk || sseBuffer.trim()) {
          const parsed = parseChatSseChunk(`${finalChunk}\n\n`, sseBuffer);
          sseBuffer = parsed.buffer;
          for (const data of parsed.events) {
            applyStreamEvent(data);
          }
        }

        const msgId = `msg-${Date.now()}`;
        const assistantMsg: Message = {
          id: msgId,
          role: "assistant",
          content: !streamCompleted && fullContent
            ? `${fullContent} (Response may be incomplete)`
            : fullContent || "I didn't receive a complete response. Please try again.",
          events: agentEvents.length > 0 ? [...agentEvents] : undefined,
        };

        if (!streamCompleted && fullContent) {
          setIncompleteMessageId(msgId);
        }

        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent("");
        setStreamingEvents([]);
        const prevGoalCount = await prevGoalCountPromise;
        pollForGoals(prevGoalCount);
        // Check for XP/achievement/level changes
        setTimeout(() => checkProgression(), 2000);
      } catch (err) {
        console.error("Send error:", err instanceof Error ? err.message : "Unknown error");
        const message = err instanceof Error ? err.message : "Sorry, I had trouble responding. Please try again.";
        setChatError(message);
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: message.includes("API key") || message.includes("Sage is not configured")
              ? "Sage needs a Gemini API key before it can respond. Open Settings to add a personal key, or ask staff to configure the shared one."
              : message,
          },
        ]);
      } finally {
        greetingGenerationRef.current++;
        setIsLoading(false);
        setStreamingEvents([]);
        // B4: Ensure optimistic greeting is always cleared when streaming ends,
        // including on error paths.
        setOptimisticGreeting(null);
      }
    },
    [conversationId, messages.length, deriveStageFromGoals, pollForGoals, refreshConversationList, checkProgression, searchParams, defaultStage, requestedStageOpener]
  );

  // Deep link: auto-send a contextual first message when arriving from "Ask Sage" links
  useEffect(() => {
    const prompt = searchParams.get("prompt")?.trim();
    const topic = searchParams.get("topic");
    const name = searchParams.get("name");

    if (messages.length === 0 && !conversationId) {
      let autoMessage = "";
      if (prompt) {
        autoMessage = prompt.slice(0, 1000);
      } else if (topic === "form" && name) {
        autoMessage = `Can you tell me about the "${name}" form? What is it for and what do I need to know about it?`;
      } else if (topic === "cert" && name) {
        autoMessage = `I'd like to learn about the ${name} certification. What does it involve and how do I get started?`;
      } else if (topic === "platform" && name) {
        autoMessage = `Can you help me understand how to use ${name}? How do I get started with it?`;
      } else if (name) {
        autoMessage = `I have a question about ${name}.`;
      }

      // Auto-send after a brief delay to let the UI render
      if (autoMessage) {
        setTimeout(() => handleSend(autoMessage), 500);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            className="rounded-xl border border-[var(--chat-panel-border)] px-2.5 py-2 text-[var(--ink-muted)] hover:bg-[var(--chat-sidebar-hover)] hover:text-[var(--ink-strong)] md:hidden"
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
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5" role="log" aria-label="Conversation with Sage" aria-live="polite">
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
                <MessageBubble role={msg.role} content={msg.content} />
                {msg.events?.length ? <AgentEventList events={msg.events} /> : null}
                {msg.id === incompleteMessageId && (
                  <button
                    onClick={() => {
                      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
                      if (lastUserMsg) {
                        setMessages((prev) => prev.filter((m) => m.id !== incompleteMessageId));
                        setIncompleteMessageId(null);
                        void handleSend(lastUserMsg.content);
                      }
                    }}
                    type="button"
                    className="ml-11 mt-2 text-xs font-semibold text-[var(--chat-sage-action)] hover:text-[var(--ink-strong)]"
                  >
                    Retry response
                  </button>
                )}
              </div>
            ))}

            {/* B4: Optimistic greeting — visible from send until first SSE text chunk */}
            {optimisticGreeting && !streamingContent && (
              <div>
                <MessageBubble role="assistant" content={optimisticGreeting} isStreaming />
                <p className="ml-11 mt-1 text-[11px] text-[var(--ink-muted)]">sending…</p>
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

            {isLoading && !streamingContent && !optimisticGreeting && <TypingIndicator />}

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

        {chatError && (
          <div role="alert" className="mx-4 mb-2 rounded-xl border border-[var(--chat-error-border)] bg-[var(--chat-error-bg)] px-4 py-3 text-sm text-[var(--chat-error-text)]">
            <p>{chatError}</p>
            {(chatError.includes("API key") || chatError.includes("Sage is not configured")) && (
              <Link href="/settings" prefetch={false} className="mt-2 inline-block font-semibold text-[var(--chat-sage-action)] hover:text-[var(--ink-strong)]">
                Open Settings →
              </Link>
            )}
          </div>
        )}

        <ChatInput onSend={handleSend} disabled={isLoading} role={role} />
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
}

export default function ChatWindow({ role = "student", defaultStage }: ChatWindowProps = {}) {
  return (
    <Suspense>
      <ChatWindowInner role={role} defaultStage={defaultStage} />
    </Suspense>
  );
}
