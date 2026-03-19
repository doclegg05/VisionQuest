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
import { useProgression } from "@/components/progression/ProgressionProvider";

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

function ChatWindowInner() {
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestPollIdRef = useRef(0);

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
      console.error("Failed to load conversation:", err);
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
        console.error("Failed to load conversations:", err);
      }
    }

    void loadActiveConversation();
  }, [loadConversationById]);

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setStreamingContent("");
    setIncompleteMessageId(null);
    setChatError(null);
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

      try {
        const goalsRes = await apiFetch("/api/goals");
        if (goalsRes.ok) {
          const goalsData = await goalsRes.json();
          prevGoalCount = goalsData.goals.length;
        }
      } catch {
        // Ignore goal count failures.
      }

      const userMsg: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setStreamingContent("");

      try {
        const res = await apiFetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, conversationId }),
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
                if (data.text) {
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
        console.error("Send error:", err);
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
      }
    },
    [conversationId, pollForGoals, refreshConversationList, checkProgression]
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

      <div className="flex min-w-0 flex-1 flex-col bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.38)_100%)]">
        <div className="md:hidden flex items-center gap-3 border-b border-[rgba(18,38,63,0.08)] bg-[rgba(255,255,255,0.7)] px-4 py-3 backdrop-blur">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            type="button"
            className="rounded-2xl border border-[rgba(18,38,63,0.1)] px-3 py-2 text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.04)] hover:text-[var(--ink-strong)]"
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

            {streamingContent && (
              <MessageBubble role="assistant" content={streamingContent} isStreaming />
            )}

            {isLoading && !streamingContent && <TypingIndicator />}

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
          <div className="mx-4 mb-2 rounded-[1.15rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p>{chatError}</p>
            {(chatError.includes("API key") || chatError.includes("Sage is not configured")) && (
              <Link href="/settings" prefetch={false} className="mt-2 inline-block font-semibold text-[var(--accent-strong)] hover:text-[var(--ink-strong)]">
                Open Settings →
              </Link>
            )}
          </div>
        )}

        <ChatInput onSend={handleSend} disabled={isLoading} />
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

export default function ChatWindow() {
  return (
    <Suspense>
      <ChatWindowInner />
    </Suspense>
  );
}
