"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import ChatInput from "./ChatInput";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import { useProgression } from "@/components/progression/ProgressionProvider";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface SageMiniChatProps {
  open: boolean;
  onClose: () => void;
}

export function SageMiniChat({ open, onClose }: SageMiniChatProps) {
  const { checkProgression } = useProgression();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Load active conversation on first open
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;

    async function loadActive() {
      try {
        const res = await apiFetch("/api/chat/conversations");
        if (!res.ok) return;
        const data = await res.json();
        const active = data.conversations?.find((c: { active: boolean }) => c.active);
        if (active) {
          const histRes = await apiFetch(`/api/chat/history?conversationId=${active.id}`);
          if (histRes.ok) {
            const hist = await histRes.json();
            setConversationId(active.id);
            setMessages(
              hist.messages.map((m: { id: string; role: string; content: string }) => ({
                id: m.id,
                role: m.role === "user" ? "user" : "assistant",
                content: m.content,
              }))
            );
          }
        }
      } catch {
        // Ignore load errors in mini chat.
      }
    }

    void loadActive();
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const handleSend = useCallback(
    async (text: string) => {
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
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to send message.");
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const data = JSON.parse(line.slice(6));
                if (data.conversationId) setConversationId(data.conversationId);
                if (data.text) {
                  fullContent += data.text;
                  setStreamingContent(fullContent);
                }
              } catch {
                // Skip malformed chunks.
              }
            }
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            role: "assistant",
            content: fullContent || "I didn't receive a response. Please try again.",
          },
        ]);
        setStreamingContent("");
        setTimeout(() => checkProgression(), 2000);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: "assistant", content: message },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, checkProgression]
  );

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Chat with Sage"
      className="fixed bottom-20 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[rgba(18,38,63,0.12)] bg-white shadow-[0_24px_64px_rgba(7,23,43,0.22)] md:bottom-6 md:right-6"
      style={{ maxHeight: "min(32rem, calc(100dvh - 7rem))" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[rgba(18,38,63,0.08)] bg-[linear-gradient(135deg,var(--ink-strong),rgba(8,68,80,0.95))] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-xl bg-white/15 text-sm font-bold text-white">
            S
          </span>
          <span className="text-sm font-semibold text-white">Sage</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/chat"
            className="rounded-lg px-2 py-1 text-[11px] font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Open full chat"
          >
            Expand
          </a>
          <button
            onClick={onClose}
            type="button"
            className="grid h-7 w-7 place-items-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close chat"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4" role="log" aria-label="Conversation with Sage" aria-live="polite">
        <div className="space-y-3">
          {messages.length === 0 && !isLoading && (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-[var(--ink-strong)]">Ask Sage anything</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Goals, next steps, or what feels stuck.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
          ))}

          {streamingContent && (
            <MessageBubble role="assistant" content={streamingContent} isStreaming />
          )}

          {isLoading && !streamingContent && <TypingIndicator />}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isLoading} compact />
    </div>
  );
}
