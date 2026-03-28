"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SignaturePadProps {
  onSign: (dataUrl: string) => void;
  onCancel: () => void;
  width?: number;
  height?: number;
}

export default function SignaturePad({
  onSign,
  onCancel,
  width = 500,
  height = 200,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Scale canvas for retina displays
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1a2a3a";
  }, [width, height]);

  const getPoint = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
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
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
      }
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
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, width * dpr, height * dpr);
    setHasStrokes(false);
  }

  function handleSubmit() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    // Export at 1x resolution for a clean PNG
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = width;
    exportCanvas.height = height;
    const exportCtx = exportCanvas.getContext("2d");
    if (!exportCtx) return;
    exportCtx.drawImage(canvas, 0, 0, width, height);
    const dataUrl = exportCanvas.toDataURL("image/png");
    onSign(dataUrl);
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-[rgba(18,38,63,0.2)] bg-white">
        <canvas
          ref={canvasRef}
          className="block cursor-crosshair touch-none"
          style={{ width, height }}
          onMouseDown={startStroke}
          onMouseMove={draw}
          onMouseUp={endStroke}
          onMouseLeave={endStroke}
          onTouchStart={startStroke}
          onTouchMove={draw}
          onTouchEnd={endStroke}
        />
        {/* Signature line */}
        <div
          className="pointer-events-none absolute left-6 right-6"
          style={{ bottom: "30px" }}
        >
          <div className="border-b border-gray-300" />
          <p className="mt-1 text-center text-[10px] text-gray-400">Sign above this line</p>
        </div>
        {!hasStrokes && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-gray-300">Draw your signature here</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={clearPad}
          disabled={!hasStrokes}
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
            onClick={handleSubmit}
            disabled={!hasStrokes}
            className="primary-button px-5 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sign & Submit
          </button>
        </div>
      </div>
    </div>
  );
}
