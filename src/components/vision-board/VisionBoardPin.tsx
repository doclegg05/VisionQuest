"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VisionBoardItemData } from "./VisionBoard";

interface VisionBoardPinProps {
  item: VisionBoardItemData;
  onDelete: (id: string) => void;
}

const NOTE_COLORS: Record<string, { shell: string; text: string; line: string }> = {
  yellow: {
    shell: "border-[#e3c763] bg-[#f4e38d]",
    text: "text-[#5b4c22]",
    line: "bg-[rgba(116,89,28,0.1)]",
  },
  pink: {
    shell: "border-[#e8b5c4] bg-[#f8d7e2]",
    text: "text-[#6d3750]",
    line: "bg-[rgba(124,73,91,0.1)]",
  },
  blue: {
    shell: "border-[#b7d4ea] bg-[#d8ecfb]",
    text: "text-[#355468]",
    line: "bg-[rgba(67,97,118,0.1)]",
  },
  green: {
    shell: "border-[#b8ddc1] bg-[#d8f0dc]",
    text: "text-[#30573b]",
    line: "bg-[rgba(58,97,65,0.1)]",
  },
  white: {
    shell: "border-[#d9d9d2] bg-[#fcfbf7]",
    text: "text-[#494949]",
    line: "bg-[rgba(72,72,72,0.08)]",
  },
};

const PIN_COLORS: Record<string, string> = {
  red: "from-red-400 to-red-600",
  blue: "from-blue-400 to-blue-600",
  green: "from-green-400 to-green-600",
  yellow: "from-yellow-400 to-yellow-500",
};

const WIDTH_BOUNDS: Record<VisionBoardItemData["type"], { min: number; max: number; minPx: number }> = {
  note: { min: 14, max: 34, minPx: 150 },
  goal: { min: 16, max: 34, minPx: 175 },
  image: { min: 18, max: 42, minPx: 190 },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function VisionBoardPin({ item, onDelete }: VisionBoardPinProps) {
  const [hovering, setHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [touchOffset, setTouchOffset] = useState<{ x: number; y: number } | null>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number; boardWidth: number } | null>(null);

  const pinGradient = PIN_COLORS[item.pinColor] || PIN_COLORS.red;
  const noteStyle = NOTE_COLORS[item.color || "yellow"] || NOTE_COLORS.yellow;
  const widthBounds = WIDTH_BOUNDS[item.type];

  const dispatchMove = useCallback((posX: number, posY: number) => {
    const event = new CustomEvent("pinmove", { detail: { id: item.id, posX, posY }, bubbles: true });
    pinRef.current?.dispatchEvent(event);
  }, [item.id]);

  const dispatchResize = useCallback((width: number) => {
    const event = new CustomEvent("pinmove", { detail: { id: item.id, width }, bubbles: true });
    pinRef.current?.dispatchEvent(event);
  }, [item.id]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (isResizing) {
      e.preventDefault();
      return;
    }

    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-resize-handle='true']")) {
      e.preventDefault();
      return;
    }

    const el = pinRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.setData("offsetX", String(e.clientX - rect.left));
    e.dataTransfer.setData("offsetY", String(e.clientY - rect.top));
    e.dataTransfer.effectAllowed = "move";
  }, [isResizing, item.id]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-resize-handle='true']")) {
      return;
    }

    const touch = e.touches[0];
    const el = pinRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startClientX = touch.clientX;
    const startClientY = touch.clientY;

    longPressTimerRef.current = setTimeout(() => {
      setIsDragging(true);
      touchStartRef.current = {
        x: startClientX,
        y: startClientY,
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
    if (!canvas) {
      setIsDragging(false);
      setTouchOffset(null);
      touchStartRef.current = null;
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const finalX = touchStartRef.current.startX + touchOffset.x - canvasRect.left;
    const finalY = touchStartRef.current.startY + touchOffset.y - canvasRect.top;
    const posX = clamp((finalX / canvasRect.width) * 100, 0, 100 - item.width);
    const posY = clamp((finalY / canvasRect.height) * 100, 0, 90);

    dispatchMove(posX, posY);

    setIsDragging(false);
    setTouchOffset(null);
    touchStartRef.current = null;
  }, [dispatchMove, isDragging, item.width, touchOffset]);

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const board = pinRef.current?.parentElement;
    if (!board) return;

    resizeStateRef.current = {
      startX: e.clientX,
      startWidth: item.width,
      boardWidth: board.getBoundingClientRect().width,
    };
    setIsResizing(true);
  }, [item.width]);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const deltaX = event.clientX - resizeState.startX;
      const width = clamp(
        resizeState.startWidth + (deltaX / resizeState.boardWidth) * 100,
        widthBounds.min,
        widthBounds.max,
      );
      dispatchResize(width);
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dispatchResize, isResizing, widthBounds.max, widthBounds.min]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  return (
    <div
      ref={pinRef}
      draggable={!isResizing}
      onDragStart={handleDragStart}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="absolute cursor-grab select-none active:cursor-grabbing group"
      style={{
        left: `${item.posX}%`,
        top: `${item.posY}%`,
        width: `${item.width}%`,
        minWidth: `${widthBounds.minPx}px`,
        zIndex: item.zIndex,
        transform: `rotate(${item.rotation}deg)${touchOffset ? ` translate(${touchOffset.x}px, ${touchOffset.y}px)` : ""}`,
        transition: isDragging || isResizing ? "none" : "transform 180ms ease, box-shadow 180ms ease",
        touchAction: isDragging || isResizing ? "none" : "auto",
      }}
    >
      <div className="absolute -top-2 left-1/2 z-10 -translate-x-1/2">
        <div
          className={`h-4 w-4 rounded-full bg-gradient-to-br ${pinGradient} shadow-[0_2px_4px_rgba(0,0,0,0.3)]`}
          style={{ boxShadow: "0 2px 4px rgba(0,0,0,0.3), inset 0 -1px 2px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.3) inset" }}
        />
        <div className="absolute left-1/2 top-3 h-1 w-2 -translate-x-1/2 rounded-full bg-black/10 blur-[1px]" />
      </div>

      {hovering ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item.id);
          }}
          className="absolute -right-2 -top-3 z-20 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-xs text-white shadow-md transition-colors hover:bg-red-600"
          aria-label="Delete pin"
        >
          ×
        </button>
      ) : null}

      {item.type === "note" ? (
        <div
          className={`relative mt-2 overflow-hidden rounded-[1rem] border px-4 pb-4 pt-5 shadow-[2px_4px_10px_rgba(0,0,0,0.14)] ${
            hovering ? "scale-[1.02] shadow-[4px_8px_16px_rgba(0,0,0,0.18)]" : ""
          } ${noteStyle.shell}`}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.38),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.22),transparent_32%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-45 [background-image:repeating-linear-gradient(180deg,transparent_0_1.45rem,rgba(255,255,255,0.14)_1.45rem_1.52rem)]" />
          <div className={`pointer-events-none absolute inset-x-0 top-4 h-px ${noteStyle.line}`} />
          <div className="pointer-events-none absolute right-0 top-0 h-7 w-7 translate-x-[24%] -translate-y-[24%] rotate-45 rounded-sm bg-[var(--surface-raised)]/35 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" />
          <p className={`relative text-sm leading-6 whitespace-pre-wrap ${noteStyle.text}`}>
            {item.content}
          </p>
        </div>
      ) : item.type === "goal" ? (
        <div
          className={`relative mt-2 overflow-hidden rounded-[1rem] border border-[rgba(15,154,146,0.2)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(235,249,248,0.94))] p-4 shadow-[2px_4px_10px_rgba(0,0,0,0.14)] ${
            hovering ? "scale-[1.02] shadow-[4px_8px_16px_rgba(0,0,0,0.18)]" : ""
          }`}
        >
          <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:repeating-linear-gradient(180deg,transparent_0_1.6rem,rgba(15,154,146,0.08)_1.6rem_1.66rem)]" />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-secondary)]">
              Linked goal
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-strong)]">{item.content}</p>
          </div>
        </div>
      ) : (
        <div
          className={`mt-2 overflow-hidden rounded-[1rem] border border-white/70 bg-[var(--surface-raised)] p-2 shadow-[2px_4px_10px_rgba(0,0,0,0.14)] ${
            hovering ? "scale-[1.02] shadow-[4px_8px_16px_rgba(0,0,0,0.18)]" : ""
          }`}
        >
          {item.fileId ? (
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[0.85rem] bg-[var(--surface-interactive)]">
              <Image
                src={`/api/files/download?id=${item.fileId}`}
                alt="Vision board image"
                fill
                sizes="(max-width: 768px) 50vw, 28vw"
                className="object-cover"
              />
            </div>
          ) : null}
        </div>
      )}

      <button
        type="button"
        data-resize-handle="true"
        onPointerDown={handleResizeStart}
        className="absolute bottom-1.5 right-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-white/70 bg-[var(--surface-raised)]/88 text-[var(--ink-muted)] opacity-80 shadow-[0_6px_14px_rgba(0,0,0,0.12)] transition-opacity hover:opacity-100"
        aria-label="Resize pin"
      >
        <span
          // Decorative hatch pattern inside resize handle — intentional raw rgba.
          // eslint-disable-next-line no-restricted-syntax
          className="block h-3 w-3 bg-[linear-gradient(135deg,transparent_0_34%,rgba(16,37,62,0.45)_34%_44%,transparent_44%_58%,rgba(16,37,62,0.45)_58%_68%,transparent_68%)]"
        />
      </button>
    </div>
  );
}
