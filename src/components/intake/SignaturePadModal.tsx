"use client";

import React, { useRef, useState, useEffect } from "react";
import { X, ArrowClockwise, UploadSimple, PenNib, CheckCircle } from "@phosphor-icons/react";

interface SignaturePadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    signatureDataUrl: string;
    signatureName: string;
    signatureMethod: "drawn" | "uploaded";
  }) => void;
  defaultSignerName?: string;
}

export default function SignaturePadModal({
  isOpen,
  onClose,
  onSave,
  defaultSignerName = "",
}: SignaturePadModalProps) {
  const [mode, setMode] = useState<"draw" | "upload">("draw");
  const [signerName, setSignerName] = useState(defaultSignerName);
  const [affirmed, setAffirmed] = useState(true);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setSignerName(defaultSignerName);
    setHasDrawn(false);
    setUploadedDataUrl(null);

    // Initialize canvas on next frame
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#004777"; // Deep state navy
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, defaultSignerName]);

  if (!isOpen) return null;

  // Drawing event handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    isDrawingRef.current = true;
    setHasDrawn(true);

    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setUploadedDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!affirmed || !signerName.trim()) return;

    if (mode === "draw") {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) return;
      const signatureDataUrl = canvas.toDataURL("image/png");
      onSave({
        signatureDataUrl,
        signatureName: signerName.trim(),
        signatureMethod: "drawn",
      });
    } else {
      if (!uploadedDataUrl) return;
      onSave({
        signatureDataUrl: uploadedDataUrl,
        signatureName: signerName.trim(),
        signatureMethod: "uploaded",
      });
    }
    onClose();
  };

  const canSubmit = affirmed && signerName.trim().length > 0 && (mode === "draw" ? hasDrawn : Boolean(uploadedDataUrl));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-base)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
              <PenNib size={20} weight="bold" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--ink-strong)]">Official Signature Capture</h3>
              <p className="text-xs text-[var(--ink-muted)]">State Audit Compliant • E-SIGN 15 U.S.C. § 7001</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-raised)]"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-6">
          {/* Signer Legal Name */}
          <div>
            <label className="block text-xs font-semibold text-[var(--ink-muted)]">
              Full Legal Signer Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="e.g. Morgan Vance"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--ink-strong)] placeholder:text-[var(--ink-faint)] focus:border-sky-500 focus:outline-none"
            />
          </div>

          {/* Mode Tabs */}
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setMode("draw")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition-colors ${
                mode === "draw"
                  ? "bg-[var(--surface-base)] text-sky-700 shadow-sm dark:text-sky-300"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              }`}
            >
              <PenNib size={14} weight="bold" />
              Draw with Mouse / Finger
            </button>
            <button
              type="button"
              onClick={() => setMode("upload")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition-colors ${
                mode === "upload"
                  ? "bg-[var(--surface-base)] text-sky-700 shadow-sm dark:text-sky-300"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              }`}
            >
              <UploadSimple size={14} weight="bold" />
              Upload Signature Image
            </button>
          </div>

          {/* Canvas or Upload Area */}
          {mode === "draw" ? (
            <div>
              <div className="relative overflow-hidden rounded-xl border border-dashed border-[var(--border-strong)] bg-white shadow-inner">
                <canvas
                  ref={canvasRef}
                  width={460}
                  height={150}
                  className="w-full touch-none cursor-crosshair bg-white"
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                />
                {!hasDrawn && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-slate-400">
                    Sign inside this box with your finger or mouse
                  </div>
                )}
                <div className="pointer-events-none absolute bottom-5 left-6 right-6 border-b border-slate-300" />
              </div>
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  <ArrowClockwise size={12} />
                  Clear & Redo
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] p-6 text-center">
                {uploadedDataUrl ? (
                  <div className="flex flex-col items-center gap-3">
                    <img
                      src={uploadedDataUrl}
                      alt="Uploaded signature"
                      className="max-h-24 rounded border border-slate-200 bg-white p-2 object-contain"
                    />
                    <label className="cursor-pointer text-xs font-semibold text-sky-600 hover:underline">
                      Choose another file
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <UploadSimple size={20} weight="bold" />
                    </div>
                    <span className="text-xs font-semibold text-[var(--ink-strong)]">
                      Upload photo or scan of signature
                    </span>
                    <span className="text-[11px] text-[var(--ink-muted)]">PNG, JPEG, or WebP up to 5MB</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Legal Affirmation Checkbox */}
          <label className="flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs leading-relaxed text-[var(--ink-muted)]">
            <input
              type="checkbox"
              checked={affirmed}
              onChange={(e) => setAffirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
            />
            <span>
              <strong className="text-[var(--ink-strong)]">Legal Audit Affirmation:</strong> I certify under penalty of
              law that I am the individual named above and that this digital signature constitutes my binding legal signature
              under the West Virginia Uniform Electronic Transactions Act (W. Va. Code § 39A-1-1).
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] bg-[var(--surface-raised)] px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-base)] hover:text-[var(--ink-strong)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSave}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all ${
              canSubmit
                ? "bg-sky-600 hover:bg-sky-700 shadow-sm"
                : "cursor-not-allowed bg-slate-400 opacity-60"
            }`}
          >
            <CheckCircle size={14} weight="bold" />
            Apply Signature to State Document
          </button>
        </div>
      </div>
    </div>
  );
}
