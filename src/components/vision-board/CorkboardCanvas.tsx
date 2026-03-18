"use client";

import { useRef, useCallback, useEffect } from "react";
import VisionBoardPin from "./VisionBoardPin";
import type { VisionBoardItemData } from "./VisionBoard";

interface CorkboardCanvasProps {
  items: VisionBoardItemData[];
  onMove: (id: string, posX: number, posY: number) => void;
  onDelete: (id: string) => void;
}

export default function CorkboardCanvas({ items, onMove, onDelete }: CorkboardCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const itemId = e.dataTransfer.getData("text/plain");
    const offsetX = parseFloat(e.dataTransfer.getData("offsetX") || "0");
    const offsetY = parseFloat(e.dataTransfer.getData("offsetY") || "0");
    if (!itemId) return;

    const rect = canvas.getBoundingClientRect();
    const posX = Math.max(0, Math.min(90, ((e.clientX - rect.left - offsetX) / rect.width) * 100));
    const posY = Math.max(0, Math.min(90, ((e.clientY - rect.top - offsetY) / rect.height) * 100));

    onMove(itemId, posX, posY);
  }, [onMove]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id && detail?.posX !== undefined) {
        onMove(detail.id, detail.posX, detail.posY);
      }
    };
    canvas.addEventListener("pinmove", handler);
    return () => canvas.removeEventListener("pinmove", handler);
  }, [onMove]);

  return (
    <div
      ref={canvasRef}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative min-h-[60vh] md:min-h-[65vh] overflow-hidden rounded-[1rem]"
      style={{
        background: `
          radial-gradient(ellipse at 20% 50%, rgba(210,180,140,0.3) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 20%, rgba(210,180,140,0.2) 0%, transparent 40%),
          radial-gradient(ellipse at 50% 80%, rgba(195,160,120,0.25) 0%, transparent 45%),
          linear-gradient(135deg, #c4a87c 0%, #b8956a 25%, #c9a97a 50%, #a88656 75%, #c4a87c 100%)
        `,
        boxShadow: `
          inset 0 2px 8px rgba(0,0,0,0.15),
          inset 0 -2px 8px rgba(0,0,0,0.1),
          0 4px 20px rgba(0,0,0,0.12)
        `,
        border: "8px solid",
        borderImage: "linear-gradient(135deg, #8B6F47 0%, #6B4F2F 30%, #8B6F47 50%, #5A3E20 70%, #8B6F47 100%) 1",
      }}
    >
      {/* Empty state */}
      {items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-center">
          <div className="rounded-xl bg-white/80 p-8 shadow-lg backdrop-blur">
            <p className="text-3xl mb-3">📌</p>
            <p className="font-display text-lg text-[#5A3E20]">Your vision board is empty</p>
            <p className="mt-2 text-sm text-[#8B6F47]">Use the buttons below to pin images, notes, and goals.</p>
          </div>
        </div>
      )}

      {/* Pins */}
      {items.map((item) => (
        <VisionBoardPin
          key={item.id}
          item={item}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
