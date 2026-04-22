"use client";

import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import type { ConversationSummary } from "@/types";
import { apiFetch } from "@/lib/api";

interface ConversationListProps {
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onDelete?: (conversationId: string) => void;
  activeId: string | null;
  refreshKey?: number;
}

const STAGE_LABELS: Record<string, string> = {
  onboarding: "Getting Started",
  bhag: "Big Goal",
  monthly: "Monthly Goals",
  weekly: "Weekly Goals",
  daily: "Daily Goals",
  tasks: "Action Tasks",
  checkin: "Check-in",
  review: "Review",
  general: "General",
};

export default function ConversationList({
  onSelect,
  onNewChat,
  onDelete,
  activeId,
  refreshKey = 0,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch("/api/chat/conversations");
        if (res.ok) {
          const data = await res.json();
          setConversations(data.conversations || []);
        }
      } catch (err) {
        console.error("Failed to load conversations:", err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [refreshKey]);

  async function handleDelete(
    e: React.MouseEvent,
    conv: ConversationSummary,
  ) {
    e.stopPropagation();
    if (deletingId) return;

    const label = conv.title || STAGE_LABELS[conv.stage] || "this conversation";
    const confirmed = window.confirm(
      `Delete "${label}"? This will remove the full message history and cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingId(conv.id);
    try {
      const res = await apiFetch(`/api/chat/conversations/${conv.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed (${res.status})`);
      }
      setConversations((prev) => prev.filter((c) => c.id !== conv.id));
      onDelete?.(conv.id);
    } catch (err) {
      console.error("Failed to delete conversation:", err instanceof Error ? err.message : "Unknown error");
      window.alert("Could not delete conversation. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="p-5 text-sm text-white/75">Loading conversations...</div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,rgba(7,23,43,0.98),rgba(13,35,57,0.95)_52%,rgba(8,68,80,0.92))] text-white">
      <div className="border-b border-white/10 p-4">
        <button
          onClick={onNewChat}
          type="button"
          className="primary-button w-full px-4 py-3 text-sm"
        >
          + New Conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {conversations.length === 0 ? (
          <div className="rounded-[1.2rem] border border-dashed border-white/12 bg-[var(--surface-raised)]/5 p-4 text-center text-sm text-white/75">
            No conversations yet. Start one!
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = activeId === conv.id;
            const isDeleting = deletingId === conv.id;
            return (
              <div
                key={conv.id}
                className={`group relative mb-2 rounded-[1.15rem] border transition-colors
                  ${isActive
                    ? "border-white/40 bg-[var(--surface-raised)] text-[var(--ink-strong)] shadow-[0_18px_36px_rgba(255,255,255,0.08)]"
                    : "border-white/8 bg-[var(--surface-raised)]/6 text-white/82 hover:bg-[var(--surface-raised)]/10"
                  }
                  ${isDeleting ? "opacity-50" : ""}`}
              >
                <button
                  onClick={() => onSelect(conv.id)}
                  type="button"
                  disabled={isDeleting}
                  className="w-full px-4 py-3.5 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={`min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                      isActive ? "text-[var(--accent-strong)]" : "text-white/75"
                    }`}>
                      {STAGE_LABELS[conv.stage] || conv.stage}
                    </span>
                    {conv.active && (
                      <span className={`h-2.5 w-2.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-emerald-400"}`} />
                    )}
                  </div>
                  <p className={`mt-2 line-clamp-2 break-words pr-7 text-sm font-medium leading-5 ${isActive ? "text-[var(--ink-strong)]" : "text-white"}`}>
                    {conv.title || "New conversation"}
                  </p>
                  <p className={`mt-1 text-xs ${isActive ? "text-[var(--ink-muted)]" : "text-white/65"}`}>
                    {new Date(conv.updatedAt).toLocaleDateString()}
                  </p>
                </button>
                <button
                  onClick={(e) => handleDelete(e, conv)}
                  type="button"
                  disabled={isDeleting}
                  aria-label={`Delete conversation "${conv.title || STAGE_LABELS[conv.stage] || conv.stage}"`}
                  className="absolute right-2 top-2 rounded-full p-1.5 text-white/50 opacity-0 transition-all hover:bg-rose-500/20 hover:text-rose-300 focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
                >
                  <Trash size={16} weight="regular" aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
