"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import ChatInput from "./ChatInput";
import ConversationList from "./ConversationList";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import BrandLockup from "@/components/ui/BrandLockup";
import { StarterChips } from "./StarterChips";
import type { ChatRole } from "@/lib/chat/commands";
import { useProgression } from "@/components/progression/ProgressionProvider";
import { STAGE_OPENERS } from "@/lib/chat/stage-openers";
import { determineStage } from "@/lib/sage/system-prompts";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
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

function ChatWindowInner({ role, defaultStage }: ChatWindowInnerProps) {
  const searchParams = useSearchParams();
  const { checkProgression } = useProgression();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
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
  }, [messages, streamingContent, scrollToBottom]);

  useEffect(() => {
    async function loadActiveConversation() {
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
  }, [loadConversationById]);

  /**
   * B1 — Warmup fetch.
   * Fires once on mount when there is no active conversation so the backend
   * can warm the base-context cache before the student sends their first
   * message. Fire-and-forget: errors are silently discarded and we never
   * block render or chat interaction waiting for it.
   */
  useEffect(() => {
    if (warmupFiredRef.current || conversationId) return;
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
    setConversationId(null);
    setMessages([]);
    setStreamingContent("");
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
    async (text: string) => {
      let prevGoalCount = 0;
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

      // B4: If this is the first message of a new conversation (no conversationId
      // and no prior messages), show an optimistic greeting immediately while SSE
      // is in flight. Discard it if the user sends a second message before SSE
      // arrives (handled by checking messages.length in the SSE reader below).
      const isFirstMessage = !conversationId && messages.length === 0;
      if (isFirstMessage) {
        // Derive stage asynchronously — don't await here so rendering isn't blocked.
        // The greeting will appear as soon as the stage resolves (typically <200ms).
        void deriveStageFromGoals().then((stage) => {
          setOptimisticGreeting(STAGE_OPENERS[stage]);
        });
      }

      try {
        const goalsRes = await apiFetch("/api/goals");
        if (goalsRes.ok) {
          const goalsData = await goalsRes.json();
          prevGoalCount = goalsData.goals.length;
        }
      } catch {
        // Ignore goal count failures.
      }

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

        const maybeRefreshConversations = (nextId?: string) => {
          if (!refreshedConversationList && nextId && nextId !== conversationId) {
            refreshConversationList();
            refreshedConversationList = true;
          }
        };

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;

              try {
                const data = JSON.parse(line.slice(6));
                if (data.conversationId && !data.done) {
                  setConversationId(data.conversationId);
                  maybeRefreshConversations(data.conversationId);
                }
                if (data.error) throw new Error(data.error);
                if (data.text) {
                  // B4: First real token clears the optimistic greeting.
                  if (!fullContent) {
                    setOptimisticGreeting(null);
                  }
                  fullContent += data.text;
                  setStreamingContent(fullContent);
                }
                if (data.done) {
                  setConversationId(data.conversationId);
                  maybeRefreshConversations(data.conversationId);
                  streamCompleted = true;
                }
              } catch {
                // Skip malformed JSON.
              }
            }
          }
        }

        const msgId = `msg-${Date.now()}`;
        const assistantMsg: Message = {
          id: msgId,
          role: "assistant",
          content: !streamCompleted && fullContent
            ? `${fullContent} (Response may be incomplete)`
            : fullContent || "I didn't receive a complete response. Please try again.",
        };

        if (!streamCompleted && fullContent) {
          setIncompleteMessageId(msgId);
        }

        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent("");
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
        setIsLoading(false);
        // B4: Ensure optimistic greeting is always cleared when streaming ends,
        // including on error paths.
        setOptimisticGreeting(null);
      }
    },
    [conversationId, messages.length, deriveStageFromGoals, pollForGoals, refreshConversationList, checkProgression, searchParams, defaultStage]
  );

  // Deep link: auto-send a contextual first message when arriving from "Ask Sage" links
  useEffect(() => {
    const topic = searchParams.get("topic");
    const name = searchParams.get("name");

    if (topic && name && messages.length === 0 && !conversationId) {
      let autoMessage = "";
      if (topic === "form") {
        autoMessage = `Can you tell me about the "${name}" form? What is it for and what do I need to know about it?`;
      } else if (topic === "cert") {
        autoMessage = `I'd like to learn about the ${name} certification. What does it involve and how do I get started?`;
      } else if (topic === "platform") {
        autoMessage = `Can you help me understand how to use ${name}? How do I get started with it?`;
      } else {
        autoMessage = `I have a question about ${name}.`;
      }

      // Auto-send after a brief delay to let the UI render
      setTimeout(() => handleSend(autoMessage), 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex min-h-[70dvh] overflow-hidden md:h-[72vh] md:min-h-[42rem]">
      <div
        className={`absolute z-40 h-full w-[min(19rem,calc(100vw-1.5rem))] border-r border-white/10 transition-transform md:relative md:w-[19rem]
          ${showSidebar ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <ConversationList
          onSelect={loadConversationById}
          onNewChat={startNewChat}
          activeId={conversationId}
          refreshKey={conversationRefreshKey}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-[var(--chat-area-bg)]">
        <div className="md:hidden flex items-center gap-3 border-b border-[var(--chat-input-border)] bg-[var(--chat-header-bg)] px-4 py-3 backdrop-blur">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            type="button"
            className="rounded-2xl border border-[var(--border)] px-3 py-2 text-[var(--ink-muted)] hover:bg-[var(--surface-interactive)] hover:text-[var(--ink-strong)]"
          >
            ☰
          </button>
          <span className="text-sm font-semibold text-[var(--ink-strong)]">Chat with Sage</span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6" role="log" aria-label="Conversation with Sage" aria-live="polite">
          <div className="mx-auto max-w-4xl space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="mt-20 text-center text-[var(--ink-muted)]">
                <div className="mx-auto mb-5 flex justify-center">
                  <BrandLockup
                    size="md"
                    title="VisionQuest"
                    subtitle="SPOKES Workforce Development"
                    align="center"
                  />
                </div>
                <p className="font-display text-[clamp(1.9rem,6vw,3rem)] text-[var(--ink-strong)]">Welcome to VisionQuest</p>
                <p className="mt-3 text-sm leading-6">
                  Send a message to start talking with Sage about your goals, next steps, or what feels stuck.
                </p>
                <div className="mt-8">
                  <StarterChips role={role} onSelect={(prefill) => handleSend(prefill)} />
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id}>
                <MessageBubble role={msg.role} content={msg.content} />
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
                    className="ml-12 mt-2 text-xs font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]"
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
                <p className="ml-14 mt-1 text-[11px] text-[var(--ink-muted)]">sending…</p>
              </div>
            )}

            {streamingContent && (
              <MessageBubble role="assistant" content={streamingContent} isStreaming />
            )}

            {isLoading && !streamingContent && !optimisticGreeting && <TypingIndicator />}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {goalToast && (
          <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2 animate-bounce" role="alert">
            <div className="rounded-full bg-[linear-gradient(135deg,var(--accent-secondary),var(--accent))] px-5 py-2.5 text-sm font-medium text-white shadow-[0_22px_48px_rgba(15,154,146,0.24)]">
              🎯 {goalToast} +50 XP
            </div>
          </div>
        )}

        {chatError && (
          <div className="mx-4 mb-2 rounded-[1.15rem] border border-[var(--chat-error-border)] bg-[var(--chat-error-bg)] px-4 py-3 text-sm text-[var(--chat-error-text)]">
            <p>{chatError}</p>
            {(chatError.includes("API key") || chatError.includes("Sage is not configured")) && (
              <Link href="/settings" prefetch={false} className="mt-2 inline-block font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]">
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
