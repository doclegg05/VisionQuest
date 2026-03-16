"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
  read: boolean;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  markAllRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  markAllRead: async () => {},
});

export function useNotifications() {
  return useContext(NotificationContext);
}

/**
 * Single provider that manages the SSE connection and notification state.
 * Mount once in the student layout so all NotificationBell instances share one connection.
 */
export default function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch initial notifications
  useEffect(() => {
    fetch("/api/notifications?limit=10")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setNotifications(data.notifications);
          setUnreadCount(data.unreadCount);
        }
      })
      .catch(() => {});
  }, []);

  // Single SSE connection for real-time updates
  useEffect(() => {
    const evtSource = new EventSource("/api/notifications/stream");

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.connected) return;

        setNotifications((prev) => [{ ...data, read: false }, ...prev].slice(0, 20));
        setUnreadCount((prev) => prev + 1);
      } catch {
        // Ignore malformed events
      }
    };

    evtSource.onerror = () => {
      // Browser auto-reconnects EventSource
    };

    return () => evtSource.close();
  }, []);

  const markAllRead = useCallback(async () => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}
