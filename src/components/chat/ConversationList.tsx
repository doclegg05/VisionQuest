"use client";

import { useEffect, useState } from "react";
import type { ConversationSummary } from "@/types";
import { apiFetch } from "@/lib/api";

interface ConversationListProps {
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
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
  activeId,
  refreshKey = 0,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch("/api/chat/conversations");
        if (res.ok) {
          const data = await res.json();
          setConversations(data.conversations || []);
        }
      } catch (err) {
        console.error("Failed to load conversations:", err);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [refreshKey]);

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
          <div className="rounded-[1.2rem] border border-dashed border-white/12 bg-white/5 p-4 text-center text-sm text-white/75">
            No conversations yet. Start one!
          </div>
        ) : (
          conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              type="button"
              className={`mb-2 w-full rounded-[1.15rem] border px-4 py-3.5 text-left transition-colors
                ${activeId === conv.id
                  ? "border-white/40 bg-white text-[var(--ink-strong)] shadow-[0_18px_36px_rgba(255,255,255,0.08)]"
                  : "border-white/8 bg-white/6 text-white/82 hover:bg-white/10"
                }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className={`min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                  activeId === conv.id ? "text-[var(--accent-strong)]" : "text-white/75"
                }`}>
                  {STAGE_LABELS[conv.stage] || conv.stage}
                </span>
                {conv.active && (
                  <span className={`h-2.5 w-2.5 rounded-full ${activeId === conv.id ? "bg-emerald-500" : "bg-emerald-400"}`} />
                )}
              </div>
              <p className={`mt-2 line-clamp-2 break-words text-sm font-medium leading-5 ${activeId === conv.id ? "text-[var(--ink-strong)]" : "text-white"}`}>
                {conv.title || "New conversation"}
              </p>
              <p className={`mt-1 text-xs ${activeId === conv.id ? "text-[var(--ink-muted)]" : "text-white/65"}`}>
                {new Date(conv.updatedAt).toLocaleDateString()}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
