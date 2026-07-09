"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import ChatInput from "./ChatInput";
import { ActionCard } from "./ActionCard";
import { ConfirmToolCard } from "./ConfirmToolCard";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import { useProgression } from "@/components/progression/ProgressionProvider";
import { parseChatSseChunk, type ChatSseEvent } from "@/lib/chat/sse";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: MiniAction[];
}

interface MiniAction {
  action: ChatSseEvent["action"];
  target?: string;
  label?: string;
  meta?: Record<string, unknown>;
}

interface SageMiniChatProps {
  open: boolean;
  onClose: () => void;
  role?: string;
  initialMessage?: string | null;
  onInitialMessageConsumed?: () => void;
}

/**
 * Dispatch a custom event to open the Sage mini chat with a pre-composed message.
 * Can be called from anywhere in the app (e.g., InterventionQueue).
 */
export function openSageWithMessage(message: string) {
  window.dispatchEvent(
    new CustomEvent("sage:open", { detail: { message } }),
  );
}

function MiniActionList({ actions }: { actions: MiniAction[] }) {
  return (
    <div className="ml-11 mt-2 space-y-2">
      {actions.map((item, index) => {
        if (item.action === "confirm_tool" && item.meta) {
          return (
            <ConfirmToolCard
              key={`confirm-${index}`}
              label={item.label || "Confirm"}
              summary={String(item.meta.summary ?? item.label ?? "Confirm this action.")}
              meta={item.meta}
            />
          );
        }
        if (
          item.target &&
          (item.action === "open_form" ||
            item.action === "open_resource" ||
            item.action === "navigate")
        ) {
          return (
            <ActionCard
              key={`${item.action}-${item.target}-${index}`}
              action={item.action}
              target={item.target}
              label={item.label || "Open"}
              title={typeof item.meta?.title === "string" ? item.meta.title : undefined}
              description={typeof item.meta?.description === "string" ? item.meta.description : undefined}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

export function SageMiniChat({ open, onClose, role = "student", initialMessage, onInitialMessageConsumed }: SageMiniChatProps) {
  const isStaff = role === "teacher" || role === "admin";
  const { checkProgression } = useProgression();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingActions, setStreamingActions] = useState<MiniAction[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const initialMessageSentRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Load active conversation + warm the local model on first open. Warmup is
  // fire-and-forget — pre-loads gemma4 into VRAM so the user's first prompt
  // doesn't pay the 20–45s cold-start hit that produces "no response" errors.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;

    void apiFetch("/api/chat/warmup").catch(() => {
      // Warmup is best-effort; rate-limit 429s and tunnel hiccups are fine.
    });

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

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-sage-mini-initial-focus]")?.focus();
    });
  }, [open]);

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
      setStreamingActions([]);

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
        let sseBuffer = "";
        const actions: MiniAction[] = [];
        const applyStreamEvent = (data: ChatSseEvent) => {
          if (data.conversationId) setConversationId(data.conversationId);
          if (data.error) throw new Error(data.error);
          if (data.text) {
            fullContent += data.text;
            setStreamingContent(fullContent);
          }
          if (data.type === "action") {
            actions.push({
              action: data.action,
              target: data.target,
              label: data.label,
              meta: data.meta,
            });
            setStreamingActions([...actions]);
          }
        };

        if (reader) {
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
            for (const data of parsed.events) {
              applyStreamEvent(data);
            }
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            role: "assistant",
            content: fullContent || "I didn't receive a response. Please try again.",
            actions: actions.length > 0 ? actions : undefined,
          },
        ]);
        setStreamingContent("");
        setStreamingActions([]);
        if (!isStaff) {
          setTimeout(() => checkProgression(), 2000);
        }
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
    [conversationId, checkProgression, isStaff]
  );

  // Auto-send initial message when provided via prop
  useEffect(() => {
    if (open && initialMessage && !isLoading && initialMessageSentRef.current !== initialMessage) {
      initialMessageSentRef.current = initialMessage;
      // Start a fresh conversation for contextual asks
      setConversationId(null);
      setMessages([]);
      onInitialMessageConsumed?.();
      void handleSend(initialMessage);
    }
  }, [open, initialMessage, isLoading, handleSend, onInitialMessageConsumed]);

  if (!open) return null;

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Chat with Sage"
      tabIndex={-1}
      onKeyDown={trapFocus}
      className="fixed bottom-20 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--chat-panel-border)] bg-[var(--chat-panel-bg)] shadow-[0_24px_64px_rgba(7,23,43,0.28)] md:bottom-6 md:right-6"
      style={{ maxHeight: "min(32rem, calc(100dvh - 7rem))" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--chat-panel-border)] bg-[var(--chat-header-bg)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--chat-sage-mark-bg)] text-xs font-bold text-[var(--chat-sage-mark)]">
            S
          </span>
          <span className="text-sm font-semibold text-[var(--ink-strong)]">Sage</span>
        </div>
        <div className="flex items-center gap-2">
          {!isStaff && (
            <a
              href="/chat"
              data-sage-mini-initial-focus
              className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--chat-sidebar-hover)] hover:text-[var(--ink-strong)]"
              aria-label="Open full chat"
            >
              Expand
            </a>
          )}
          <button
            onClick={onClose}
            type="button"
            data-sage-mini-initial-focus={isStaff ? true : undefined}
            className="grid h-11 w-11 place-items-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--chat-sidebar-hover)] hover:text-[var(--ink-strong)]"
            aria-label="Close chat"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-3 py-4"
        style={{ background: "var(--chat-area-bg)" }}
        role="log"
        aria-label="Conversation with Sage"
        aria-live="polite"
      >
        <div className="space-y-3">
          {messages.length === 0 && !isLoading && (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-[var(--ink-strong)]">
                {isStaff ? "Ask Sage for help" : "Ask Sage anything"}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {isStaff
                  ? "Program info, student advising, or drafting communications."
                  : "Goals, next steps, or what feels stuck."}
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id}>
              <MessageBubble role={msg.role} content={msg.content} />
              {msg.actions?.length ? <MiniActionList actions={msg.actions} /> : null}
            </div>
          ))}

          {streamingContent && (
            <div>
              <MessageBubble role="assistant" content={streamingContent} isStreaming />
              {streamingActions.length > 0 ? <MiniActionList actions={streamingActions} /> : null}
            </div>
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
