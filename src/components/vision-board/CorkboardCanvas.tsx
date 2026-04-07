"use client";

import { useRef, useCallback, useEffect } from "react";
import VisionBoardPin from "./VisionBoardPin";
import type { VisionBoardItemData } from "./VisionBoard";

interface CorkboardCanvasProps {
  items: VisionBoardItemData[];
  onMove: (id: string, posX: number, posY: number) => void;
  onResize: (id: string, width: number) => void;
  onDelete: (id: string) => void;
}

export default function CorkboardCanvas({ items, onMove, onResize, onDelete }: CorkboardCanvasProps) {
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
    const item = items.find((entry) => entry.id === itemId);
    const maxX = item ? Math.max(0, 100 - item.width) : 90;

    const rect = canvas.getBoundingClientRect();
    const posX = Math.max(0, Math.min(maxX, ((e.clientX - rect.left - offsetX) / rect.width) * 100));
    const posY = Math.max(0, Math.min(90, ((e.clientY - rect.top - offsetY) / rect.height) * 100));

    onMove(itemId, posX, posY);
  }, [items, onMove]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id && detail?.posX !== undefined) {
        onMove(detail.id, detail.posX, detail.posY);
      }
      if (detail?.id && detail?.width !== undefined) {
        onResize(detail.id, detail.width);
      }
    };
    canvas.addEventListener("pinmove", handler);
    return () => canvas.removeEventListener("pinmove", handler);
  }, [onMove, onResize]);

  return (
    <div className="pb-2">
      {/* Mobile: stacked scrollable card list */}
      <div className="md:hidden space-y-3">
        {items.length === 0 ? (
          <div className="flex items-center justify-center rounded-[1.35rem] border border-[rgba(196,168,124,0.4)] bg-[linear-gradient(145deg,#c4a87c_0%,#b8956a_24%,#c9a97a_49%,#a88656_74%,#c4a87c_100%)] px-6 py-12 text-center shadow-[0_8px_24px_rgba(52,34,15,0.15)]">
            <div className="rounded-[1.4rem] border border-white/55 bg-[var(--surface-raised)]/82 p-6 shadow-[0_18px_45px_rgba(68,43,18,0.18)]">
              <p className="mb-3 text-3xl">📌</p>
              <p className="font-display text-base text-[#5A3E20]">Your vision board is empty</p>
              <p className="mt-2 text-sm text-[#8B6F47]">
                Start by pinning a note, image, or goal.
              </p>
            </div>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-[rgba(196,168,124,0.35)] bg-[linear-gradient(145deg,#c9a97a,#b8956a)] p-1">
              <div className="rounded-xl bg-[var(--surface-raised)]/90 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {item.type === "note" && (
                      <p className="text-sm text-[var(--ink-strong)] whitespace-pre-wrap break-words">{item.content}</p>
                    )}
                    {item.type === "image" && item.fileId && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={`/api/files/download?id=${item.fileId}`} alt={item.content || "Vision board image"} className="max-h-48 w-full rounded-lg object-cover" loading="lazy" />
                    )}
                    {item.type === "goal" && (
                      <div>
                        <span className="mb-1 inline-block rounded-full bg-[var(--accent-green)]/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent-green)]">Goal</span>
                        <p className="text-sm font-medium text-[var(--ink-strong)] break-words">{item.content}</p>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onDelete(item.id)}
                    type="button"
                    aria-label="Remove pin"
                    className="shrink-0 rounded-full p-1.5 text-[var(--ink-faint)] hover:bg-red-50 hover:text-red-500 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop: full corkboard canvas */}
      <div className="hidden md:block overflow-x-auto">
      <div
        ref={canvasRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="relative h-[72vh] min-h-[42rem] min-w-[68rem] overflow-hidden rounded-[1.35rem] border-[10px] border-transparent bg-[linear-gradient(145deg,#c4a87c_0%,#b8956a_24%,#c9a97a_49%,#a88656_74%,#c4a87c_100%)] shadow-[0_24px_80px_rgba(52,34,15,0.2)] [border-image:linear-gradient(135deg,#8B6F47_0%,#6B4F2F_30%,#8B6F47_52%,#5A3E20_72%,#8B6F47_100%)_1]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_24%,rgba(255,246,228,0.18)_0%,transparent_42%),radial-gradient(ellipse_at_78%_18%,rgba(255,246,228,0.14)_0%,transparent_36%),radial-gradient(ellipse_at_50%_84%,rgba(102,69,29,0.12)_0%,transparent_44%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:radial-gradient(rgba(92,58,20,0.18)_0.7px,transparent_0.7px)] [background-size:14px_14px]" />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_2px_8px_rgba(0,0,0,0.15),inset_0_-2px_10px_rgba(0,0,0,0.12)]" />

        {/* Empty state */}
        {items.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="rounded-[1.4rem] border border-white/55 bg-[var(--surface-raised)]/82 p-8 shadow-[0_18px_45px_rgba(68,43,18,0.18)]">
              <p className="mb-3 text-3xl">📌</p>
              <p className="font-display text-lg text-[#5A3E20]">Your vision board is empty</p>
              <p className="mt-2 text-sm text-[#8B6F47]">
                Start by pinning a note, image, or goal. You can drag cards anywhere and resize them from the lower corner.
              </p>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute left-5 top-4 rounded-full bg-[var(--surface-raised)]/24 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/80 shadow-[0_8px_16px_rgba(70,42,10,0.14)]">
          Creative workspace
        </div>

        {/* Pins */}
        {items.map((item) => (
          <VisionBoardPin
            key={item.id}
            item={item}
            onDelete={onDelete}
          />
        ))}
      </div>
      <p className="mt-2 px-1 text-xs text-[var(--ink-muted)]">
        Tip: if the board feels larger than your screen, scroll sideways inside the workspace to reach the full corkboard.
      </p>
      </div>
    </div>
  );
}
