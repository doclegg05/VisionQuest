"use client";

import { useState, useRef, useCallback } from "react";
import type { VisionBoardItemData } from "./VisionBoard";

interface VisionBoardPinProps {
  item: VisionBoardItemData;
  onDelete: (id: string) => void;
}

const NOTE_COLORS: Record<string, string> = {
  yellow: "bg-amber-100 border-amber-200",
  pink: "bg-pink-100 border-pink-200",
  blue: "bg-sky-100 border-sky-200",
  green: "bg-emerald-100 border-emerald-200",
  white: "bg-white border-gray-200",
};

const PIN_COLORS: Record<string, string> = {
  red: "from-red-400 to-red-600",
  blue: "from-blue-400 to-blue-600",
  green: "from-green-400 to-green-600",
  yellow: "from-yellow-400 to-yellow-500",
};

export default function VisionBoardPin({ item, onDelete }: VisionBoardPinProps) {
  const [hovering, setHovering] = useState(false);
  const pinRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    const el = pinRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.setData("offsetX", String(e.clientX - rect.left));
    e.dataTransfer.setData("offsetY", String(e.clientY - rect.top));
    e.dataTransfer.effectAllowed = "move";
  }, [item.id]);

  // Touch drag support
  const touchStartRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [touchOffset, setTouchOffset] = useState<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const el = pinRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    longPressTimerRef.current = setTimeout(() => {
      setIsDragging(true);
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        startX: rect.left,
        startY: rect.top,
      };
    }, 200);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || !touchStartRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    setTouchOffset({ x: deltaX, y: deltaY });
  }, [isDragging]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (!isDragging || !touchStartRef.current || !touchOffset) {
      setIsDragging(false);
      setTouchOffset(null);
      return;
    }

    const canvas = pinRef.current?.parentElement;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const finalX = touchStartRef.current.startX + touchOffset.x - canvasRect.left;
    const finalY = touchStartRef.current.startY + touchOffset.y - canvasRect.top;
    const posX = Math.max(0, Math.min(90, (finalX / canvasRect.width) * 100));
    const posY = Math.max(0, Math.min(90, (finalY / canvasRect.height) * 100));

    // Dispatch custom event for parent to handle
    const event = new CustomEvent("pinmove", { detail: { id: item.id, posX, posY }, bubbles: true });
    pinRef.current?.dispatchEvent(event);

    setIsDragging(false);
    setTouchOffset(null);
    touchStartRef.current = null;
  }, [isDragging, touchOffset, item.id]);

  const pinGradient = PIN_COLORS[item.pinColor] || PIN_COLORS.red;

  return (
    <div
      ref={pinRef}
      draggable
      onDragStart={handleDragStart}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="absolute cursor-grab active:cursor-grabbing group"
      style={{
        left: `${item.posX}%`,
        top: `${item.posY}%`,
        width: `${item.width}%`,
        minWidth: "80px",
        maxWidth: "200px",
        zIndex: item.zIndex,
        transform: `rotate(${item.rotation}deg)${touchOffset ? ` translate(${touchOffset.x}px, ${touchOffset.y}px)` : ""}`,
        transition: isDragging ? "none" : "box-shadow 200ms ease",
        touchAction: isDragging ? "none" : "auto",
      }}
    >
      {/* Pushpin */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
        <div
          className={`h-4 w-4 rounded-full bg-gradient-to-br ${pinGradient} shadow-[0_2px_4px_rgba(0,0,0,0.3)]`}
          style={{ boxShadow: "0 2px 4px rgba(0,0,0,0.3), inset 0 -1px 2px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.3) inset" }}
        />
        {/* Pin shadow on board */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 h-1 w-2 rounded-full bg-black/10 blur-[1px]" />
      </div>

      {/* Delete button */}
      {hovering && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
          className="absolute -top-3 -right-2 z-20 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-[10px] text-white shadow-md hover:bg-red-600 transition-colors"
        >
          ×
        </button>
      )}

      {/* Card content */}
      <div
        className={`mt-2 rounded-lg overflow-hidden shadow-[2px_3px_8px_rgba(0,0,0,0.15)] transition-transform ${
          hovering ? "scale-[1.03] shadow-[3px_5px_12px_rgba(0,0,0,0.2)]" : ""
        } ${
          item.type === "note"
            ? `border ${NOTE_COLORS[item.color || "yellow"] || NOTE_COLORS.yellow} p-3`
            : item.type === "goal"
              ? "border border-[rgba(15,154,146,0.2)] bg-gradient-to-br from-white to-teal-50 p-3"
              : "bg-white border border-gray-200 p-1.5"
        }`}
      >
        {item.type === "image" && item.fileId && (
          <img
            src={`/api/files/download?id=${item.fileId}`}
            alt="Vision board image"
            className="w-full rounded object-cover"
            style={{ maxHeight: "150px" }}
          />
        )}

        {item.type === "note" && (
          <p className="text-xs leading-relaxed text-gray-800 whitespace-pre-wrap">
            {item.content}
          </p>
        )}

        {item.type === "goal" && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-secondary)]">🎯 Goal</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ink-strong)]">{item.content}</p>
          </div>
        )}
      </div>
    </div>
  );
}
