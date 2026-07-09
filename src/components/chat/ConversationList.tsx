"use client";

import { useEffect, useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import type { ConversationSummary } from "@/types";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/ui/useConfirm";

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
  const { confirm, alert, confirmDialog } = useConfirm();

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
    const confirmed = await confirm({
      title: `Delete "${label}"?`,
      message: "This will remove the full message history and cannot be undone.",
      confirmLabel: "Delete",
    });
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
      await alert({ title: "Could not delete conversation", message: "Please try again." });
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col bg-[var(--chat-sidebar-bg)] p-5 text-sm text-[var(--ink-muted)]">
        Loading conversations...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-r border-[var(--chat-panel-border)] bg-[var(--chat-sidebar-bg)] text-[var(--ink-strong)]">
      <div className="border-b border-[var(--chat-panel-border)] p-3">
        <button
          onClick={onNewChat}
          type="button"
          className="flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--chat-panel-border)] bg-[var(--chat-panel-bg)] px-4 text-sm font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--chat-sidebar-hover)]"
        >
          <Plus size={16} weight="bold" aria-hidden="true" />
          New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--chat-panel-border)] px-3 py-6 text-center text-sm text-[var(--ink-muted)]">
            No conversations yet. Start one!
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = activeId === conv.id;
            const isDeleting = deletingId === conv.id;
            return (
              <div
                key={conv.id}
                className={[
                  "group relative mb-1 rounded-xl transition-colors",
                  isActive
                    ? "bg-[var(--chat-sidebar-active)]"
                    : "hover:bg-[var(--chat-sidebar-hover)]",
                  isDeleting ? "opacity-50" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <button
                  onClick={() => onSelect(conv.id)}
                  type="button"
                  disabled={isDeleting}
                  className="w-full px-3 py-2.5 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={[
                        "min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
                        isActive ? "text-[var(--chat-sage-action)]" : "text-[var(--ink-muted)]",
                      ].join(" ")}
                    >
                      {STAGE_LABELS[conv.stage] || conv.stage}
                    </span>
                    {conv.active && (
                      <span
                        className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent-green)]"
                        aria-label="Active conversation"
                      />
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 break-words pr-7 text-sm font-medium leading-5 text-[var(--ink-strong)]">
                    {conv.title || "New conversation"}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                    {new Date(conv.updatedAt).toLocaleDateString()}
                  </p>
                </button>
                <button
                  onClick={(e) => handleDelete(e, conv)}
                  type="button"
                  disabled={isDeleting}
                  aria-label={`Delete conversation "${conv.title || STAGE_LABELS[conv.stage] || conv.stage}"`}
                  className="absolute right-1.5 top-1.5 rounded-lg p-1.5 text-[var(--ink-faint)] opacity-0 transition-all hover:bg-[var(--badge-error-bg)] hover:text-[var(--badge-error-text)] focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
                >
                  <Trash size={15} weight="regular" aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
