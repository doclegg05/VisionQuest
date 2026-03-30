"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNotifications } from "./NotificationProvider";
import { studentInterventionHref } from "@/lib/intervention-notifications";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Notification bell UI. Reads from NotificationProvider context
 * so multiple instances share one SSE connection.
 */
export default function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close panel on Escape or outside click; return focus to trigger
  useEffect(() => {
    if (!open) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  // Move focus into the dialog when it opens
  useEffect(() => {
    if (open) {
      // Focus the first focusable element inside the dropdown
      const first = dialogRef.current?.querySelector<HTMLElement>("button, a, [tabindex]");
      if (first) first.focus();
    }
  }, [open]);

  // Tick counter that increments each minute to refresh relative timestamps
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative" ref={panelRef}>
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        type="button"
        className="relative grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/10"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--accent-strong)] px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Notifications"
          className="fixed right-3 top-[4.5rem] z-[60] w-[min(20rem,calc(100vw-1.5rem))] max-w-[20rem] rounded-2xl border border-white/20 bg-[rgba(255,255,255,0.96)] shadow-[0_20px_60px_rgba(16,37,62,0.18)] backdrop-blur md:left-[18rem] md:right-auto md:top-4"
          style={{ maxHeight: "calc(100vh - 6rem)" }}
        >
          <div className="flex items-center justify-between border-b border-[rgba(18,38,63,0.08)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                type="button"
                className="text-xs font-medium text-[var(--accent-strong)] hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--ink-muted)]">No notifications yet</p>
            ) : (
              notifications.map((n) => {
                const href = n.type.startsWith("nudge.")
                  ? studentInterventionHref(n.type)
                  : n.type.startsWith("teacher_nudge.")
                    ? "/teacher-dashboard"
                    : n.type === "sage_daily_prompt"
                      ? "/chat"
                      : null;
                const handleClick = href
                  ? () => { setOpen(false); router.push(href); }
                  : undefined;
                const inner = (
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span aria-hidden="true" className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-[var(--accent-strong)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--ink-strong)]">{n.title}</p>
                      {n.body && <p className="mt-0.5 line-clamp-3 break-words text-xs leading-5 text-[var(--ink-muted)]">{n.body}</p>}
                      <p className="mt-1 text-[10px] text-[var(--ink-muted)]">{timeAgo(n.createdAt)}</p>
                    </div>
                  </div>
                );
                return href ? (
                  <button
                    key={n.id}
                    type="button"
                    onClick={handleClick}
                    className={`w-full text-left border-b border-[rgba(18,38,63,0.05)] px-4 py-3 ${!n.read ? "bg-[rgba(249,115,22,0.04)]" : ""} cursor-pointer hover:bg-[rgba(0,123,175,0.04)]`}
                  >
                    {inner}
                  </button>
                ) : (
                  <div
                    key={n.id}
                    className={`border-b border-[rgba(18,38,63,0.05)] px-4 py-3 ${!n.read ? "bg-[rgba(249,115,22,0.04)]" : ""}`}
                  >
                    {inner}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
