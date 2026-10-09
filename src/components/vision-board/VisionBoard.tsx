"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import CorkboardCanvas from "./CorkboardCanvas";
import VisionBoardToolbar from "./VisionBoardToolbar";
import { useProgression } from "@/components/progression/ProgressionProvider";
import { useUndo } from "@/components/ui/useUndo";

export interface VisionBoardItemData {
  id: string;
  type: "image" | "note" | "goal";
  content: string | null;
  fileId: string | null;
  goalId: string | null;
  posX: number;
  posY: number;
  width: number;
  rotation: number;
  color: string | null;
  pinColor: string;
  zIndex: number;
}

const REMOVE_FAILED_MESSAGE = "We couldn't remove that pin, so it is back on your board. Please try again.";

/** Sends the real delete. Rejects on any failure so the undo queue restores the pin. */
export async function deletePin(id: string): Promise<void> {
  const res = await fetch("/api/vision-board", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
    keepalive: true,
  });
  if (!res.ok) throw new Error(`Removing pin failed with status ${res.status}`);
}

/** Returns the list with the pin back at its old position, or the same list if it is already there. */
export function reinsertPin(items: VisionBoardItemData[], pin: VisionBoardItemData, index: number): VisionBoardItemData[] {
  if (items.some((entry) => entry.id === pin.id)) return items;
  return [...items.slice(0, index), pin, ...items.slice(index)];
}

export default function VisionBoard() {
  const { checkProgression } = useProgression();
  const { scheduleRemoval, undoToast } = useUndo();
  const [items, setItems] = useState<VisionBoardItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Pins hidden while their delete waits out the undo window. A refetch in that window must not bring them back.
  const pendingRemovalsRef = useRef<Set<string>>(new Set());

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/vision-board");
      if (res.ok) {
        const data: { items?: VisionBoardItemData[] } = await res.json();
        setItems((data.items ?? []).filter((entry) => !pendingRemovalsRef.current.has(entry.id)));
        setError(null);
      }
    } catch {
      setError("Failed to load vision board.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchItems();
    })();
  }, [fetchItems]);

  useEffect(() => {
    const timers = saveTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const saveItemLayout = useCallback((id: string, payload: Partial<Pick<VisionBoardItemData, "posX" | "posY" | "width" | "zIndex">>) => {
    const existingTimer = saveTimersRef.current.get(id);
    if (existingTimer) clearTimeout(existingTimer);

    const nextTimer = setTimeout(() => {
      fetch("/api/vision-board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...payload }),
      }).catch(() => {});
      saveTimersRef.current.delete(id);
    }, 350);

    saveTimersRef.current.set(id, nextTimer);
  }, []);

  const handleMove = useCallback((id: string, posX: number, posY: number) => {
    let nextZ = 1;
    setItems(prev => {
      const maxZ = Math.max(...prev.map(i => i.zIndex), 0);
      nextZ = maxZ + 1;
      return prev.map(item =>
        item.id === id ? { ...item, posX, posY, zIndex: nextZ } : item
      );
    });
    saveItemLayout(id, { posX, posY, zIndex: nextZ });
  }, [saveItemLayout]);

  const handleResize = useCallback((id: string, width: number) => {
    let nextZ = 1;
    let nextPosX = 0;
    setItems((prev) => {
      const maxZ = Math.max(...prev.map((entry) => entry.zIndex), 0);
      nextZ = maxZ + 1;

      return prev.map((item) => {
        if (item.id !== id) return item;
        nextPosX = Math.max(0, Math.min(100 - width, item.posX));
        return {
          ...item,
          width,
          posX: nextPosX,
          zIndex: nextZ,
        };
      });
    });

    saveItemLayout(id, { width, posX: nextPosX, zIndex: nextZ });
  }, [saveItemLayout]);

  const handleDelete = useCallback((id: string) => {
    const index = items.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    const pin = items[index];
    const pending = pendingRemovalsRef.current;

    pending.add(id);
    setRemoveError(null);
    setItems((prev) => prev.filter((entry) => entry.id !== id));
    scheduleRemoval({
      label: "Pin removed.",
      commit: async () => {
        try {
          await deletePin(id);
        } finally {
          pending.delete(id);
        }
      },
      restore: () => {
        pending.delete(id);
        setItems((prev) => reinsertPin(prev, pin, index));
      },
      onCommitError: (err) => {
        console.error("Remove pin failed:", err instanceof Error ? err.message : "Unknown error");
        setRemoveError(REMOVE_FAILED_MESSAGE);
      },
    });
  }, [items, scheduleRemoval]);

  const handleItemAdded = useCallback(() => {
    fetchItems();
    setTimeout(() => checkProgression(), 1000);
  }, [fetchItems, checkProgression]);

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading your vision board...</p>;
  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-600 mb-4">{error}</p>
      <button onClick={fetchItems} className="primary-button px-4 py-2 text-sm">Try Again</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="surface-section overflow-hidden p-3 sm:p-4">
        <div className="mb-3 flex flex-col gap-2 rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-sm text-[var(--ink-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl">
            Drag pins anywhere on the board. Use the corner grip to resize notes, images, and linked goals.
          </p>
          <span className="rounded-full bg-[rgba(15,154,146,0.1)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-secondary)]">
            {items.length} pinned
          </span>
        </div>
        {removeError && (
          <p role="alert" className="mb-3 rounded-xl bg-[var(--badge-error-bg)] px-4 py-3 text-sm text-[var(--badge-error-text)]">
            {removeError}
          </p>
        )}
        <CorkboardCanvas items={items} onMove={handleMove} onResize={handleResize} onDelete={handleDelete} />
      </div>
      <VisionBoardToolbar onItemAdded={handleItemAdded} />
      {undoToast}
    </div>
  );
}
