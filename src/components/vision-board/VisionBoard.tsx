"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import CorkboardCanvas from "./CorkboardCanvas";
import VisionBoardToolbar from "./VisionBoardToolbar";
import { useProgression } from "@/components/progression/ProgressionProvider";

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

export default function VisionBoard() {
  const { checkProgression } = useProgression();
  const [items, setItems] = useState<VisionBoardItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/vision-board");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setError(null);
      }
    } catch {
      setError("Failed to load vision board.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const savePosition = useCallback((id: string, posX: number, posY: number, zIndex: number) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch("/api/vision-board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, posX, posY, zIndex }),
      }).catch(() => {});
    }, 500);
  }, []);

  const handleMove = useCallback((id: string, posX: number, posY: number) => {
    setItems(prev => {
      const maxZ = Math.max(...prev.map(i => i.zIndex), 0);
      return prev.map(item =>
        item.id === id ? { ...item, posX, posY, zIndex: maxZ + 1 } : item
      );
    });
    const maxZ = Math.max(...items.map(i => i.zIndex), 0);
    savePosition(id, posX, posY, maxZ + 1);
  }, [items, savePosition]);

  const handleDelete = useCallback(async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      await fetch("/api/vision-board", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }, []);

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
      <CorkboardCanvas items={items} onMove={handleMove} onDelete={handleDelete} />
      <VisionBoardToolbar onItemAdded={handleItemAdded} />
    </div>
  );
}
