"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SignatureMode = "draw" | "type";

interface SignaturePadProps {
  onSign: (dataUrl: string) => void;
  onCancel: () => void;
}

const CANVAS_HEIGHT = 150;
const STROKE_COLOR = "#1a2a3a";
const STROKE_WIDTH = 2;

export default function SignaturePad({ onSign, onCancel }: SignaturePadProps) {
  const [mode, setMode] = useState<SignatureMode>("draw");
  const [typedName, setTypedName] = useState("");

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex overflow-hidden rounded-lg border border-[rgba(18,38,63,0.12)]">
        <button
          type="button"
          onClick={() => setMode("draw")}
          className={`flex-1 px-4 py-2 text-xs font-semibold transition-colors ${
            mode === "draw"
              ? "bg-[var(--ink-strong)] text-white"
              : "bg-[rgba(16,37,62,0.03)] text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.06)]"
          }`}
        >
          Draw
        </button>
        <button
          type="button"
          onClick={() => setMode("type")}
          className={`flex-1 px-4 py-2 text-xs font-semibold transition-colors ${
            mode === "type"
              ? "bg-[var(--ink-strong)] text-white"
              : "bg-[rgba(16,37,62,0.03)] text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.06)]"
          }`}
        >
          Type
        </button>
      </div>

      {mode === "draw" ? (
        <DrawPad onSign={onSign} onCancel={onCancel} />
      ) : (
        <TypePad
          typedName={typedName}
          onTypedNameChange={setTypedName}
          onSign={onSign}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Draw Mode                                                                 */
/* -------------------------------------------------------------------------- */

function DrawPad({
  onSign,
  onCancel,
}: {
  onSign: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const containerWidthRef = useRef(0);

  // Responsive canvas sizing via ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    function resize() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const width = container.clientWidth;
      const oldWidth = containerWidthRef.current;
      const dpr = window.devicePixelRatio || 1;

      // Capture existing drawing before resize (if any strokes exist)
      let savedImage: HTMLImageElement | null = null;
      if (oldWidth > 0 && canvas.width > 0 && canvas.height > 0) {
        try {
          const dataUrl = canvas.toDataURL();
          savedImage = new Image();
          savedImage.src = dataUrl;
        } catch {
          // Canvas may be tainted or empty
        }
      }

      containerWidthRef.current = width;
      canvas.width = width * dpr;
      canvas.height = CANVAS_HEIGHT * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = STROKE_WIDTH;
      ctx.strokeStyle = STROKE_COLOR;

      // Restore saved drawing if we had one
      if (savedImage && savedImage.complete && oldWidth > 0) {
        ctx.drawImage(savedImage, 0, 0, width, CANVAS_HEIGHT);
        // hasStrokes stays true — don't reset
      } else if (savedImage && oldWidth > 0) {
        // Image not loaded yet (async) — listen for load
        savedImage.onload = () => {
          const ctx = canvasRef.current?.getContext("2d");
          if (ctx && savedImage) {
            ctx.drawImage(savedImage, 0, 0, width, CANVAS_HEIGHT);
          }
        };
        // hasStrokes stays true
      } else {
        setHasStrokes(false);
      }
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const getPoint = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [],
  );

  const startStroke = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const point = getPoint(e);
      if (!point) return;
      setIsDrawing(true);
      lastPointRef.current = point;
    },
    [getPoint],
  );

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing) return;
      e.preventDefault();
      const point = getPoint(e);
      if (!point) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && lastPointRef.current) {
        ctx.beginPath();
        ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        lastPointRef.current = point;
        setHasStrokes(true);
      }
    },
    [isDrawing, getPoint],
  );

  const endStroke = useCallback(() => {
    setIsDrawing(false);
    lastPointRef.current = null;
  }, []);

  function clearPad() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = STROKE_WIDTH;
    ctx.strokeStyle = STROKE_COLOR;
    setHasStrokes(false);
  }

  function handleSubmit() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    const width = containerWidthRef.current;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = width;
    exportCanvas.height = CANVAS_HEIGHT;
    const exportCtx = exportCanvas.getContext("2d");
    if (!exportCtx) return;
    exportCtx.drawImage(canvas, 0, 0, width, CANVAS_HEIGHT);
    onSign(exportCanvas.toDataURL("image/png"));
  }

  return (
    <>
      <div ref={containerRef} className="relative overflow-hidden rounded-xl border-2 border-dashed border-[rgba(18,38,63,0.2)] bg-white">
        <canvas
          ref={canvasRef}
          className="block cursor-crosshair touch-none"
          onMouseDown={startStroke}
          onMouseMove={draw}
          onMouseUp={endStroke}
          onMouseLeave={endStroke}
          onTouchStart={startStroke}
          onTouchMove={draw}
          onTouchEnd={endStroke}
        />
        <div className="pointer-events-none absolute left-6 right-6" style={{ bottom: "24px" }}>
          <div className="border-b border-gray-300" />
          <p className="mt-1 text-center text-[10px] text-[var(--ink-muted)]">Sign above this line</p>
        </div>
        {!hasStrokes && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-gray-300">Draw your signature here</p>
          </div>
        )}
      </div>
      <SignatureButtons
        onClear={clearPad}
        onCancel={onCancel}
        onSubmit={handleSubmit}
        canClear={hasStrokes}
        canSubmit={hasStrokes}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Type Mode                                                                 */
/* -------------------------------------------------------------------------- */

function TypePad({
  typedName,
  onTypedNameChange,
  onSign,
  onCancel,
}: {
  typedName: string;
  onTypedNameChange: (name: string) => void;
  onSign: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trimmed = typedName.trim();

  function handleSubmit() {
    if (!trimmed) return;
    const width = containerRef.current?.clientWidth || 500;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, CANVAS_HEIGHT);
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, CANVAS_HEIGHT - 30);
    ctx.lineTo(width - 24, CANVAS_HEIGHT - 30);
    ctx.stroke();
    ctx.fillStyle = STROKE_COLOR;
    ctx.font = "italic 32px 'Georgia', 'Times New Roman', serif";
    ctx.textBaseline = "bottom";
    ctx.fillText(trimmed, 32, CANVAS_HEIGHT - 36);
    onSign(canvas.toDataURL("image/png"));
  }

  return (
    <>
      <div ref={containerRef} className="space-y-3">
        <div className="rounded-xl border-2 border-dashed border-[rgba(18,38,63,0.2)] bg-white p-4">
          <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-2">
            Type your full name
          </label>
          <input
            type="text"
            value={typedName}
            onChange={(e) => onTypedNameChange(e.target.value)}
            placeholder="Your full legal name"
            className="w-full border-b-2 border-gray-300 bg-transparent pb-1 text-lg text-[var(--ink-strong)] placeholder:text-gray-300 outline-none focus:border-[var(--accent-secondary)]"
            autoComplete="name"
          />
          {trimmed && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-[10px] text-[var(--ink-muted)] mb-1">Preview</p>
              <p className="font-serif text-2xl italic text-[#1a2a3a]">{trimmed}</p>
            </div>
          )}
        </div>
      </div>
      <SignatureButtons
        onClear={() => onTypedNameChange("")}
        onCancel={onCancel}
        onSubmit={handleSubmit}
        canClear={!!trimmed}
        canSubmit={!!trimmed}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shared Buttons                                                            */
/* -------------------------------------------------------------------------- */

function SignatureButtons({
  onClear,
  onCancel,
  onSubmit,
  canClear,
  canSubmit,
}: {
  onClear: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  canClear: boolean;
  canSubmit: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onClear}
        disabled={!canClear}
        className="rounded-lg border border-[rgba(18,38,63,0.12)] px-4 py-2 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)] disabled:opacity-40"
      >
        Clear
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[rgba(18,38,63,0.12)] px-4 py-2 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="primary-button px-5 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sign & Submit
        </button>
      </div>
    </div>
  );
}
