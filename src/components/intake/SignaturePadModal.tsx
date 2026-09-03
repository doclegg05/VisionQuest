"use client";

import React, { useCallback, useId, useRef, useState } from "react";
import Image from "next/image";
import { X, ArrowClockwise, UploadSimple, PenNib, CheckCircle } from "@phosphor-icons/react";
import {
  SIGNATURE_IMAGE_MAX_BYTES,
  SIGNATURE_IMAGE_MIME_TYPES,
  parseSignatureImageDataUrl,
} from "@/lib/intake/schema";

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

const MAX_SIGNATURE_EDGE_PX = 1200;
const JPEG_QUALITY_STEPS = [0.85, 0.65, 0.5];
const ACCEPTED_UPLOAD_TYPES = SIGNATURE_IMAGE_MIME_TYPES.join(",");

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That file is not a picture we can read."));
    image.src = dataUrl;
  });
}

/**
 * Shrink an uploaded signature photo to something the server will accept.
 *
 * The intake schema caps a signature at {@link SIGNATURE_IMAGE_MAX_BYTES}, and a
 * phone photo is routinely several megabytes. Redrawing through a canvas keeps a
 * plain "take a picture of your signature" flow working, and drops the camera
 * metadata along the way.
 */
async function prepareSignatureUpload(file: File): Promise<string> {
  if (!SIGNATURE_IMAGE_MIME_TYPES.includes(file.type as (typeof SIGNATURE_IMAGE_MIME_TYPES)[number])) {
    throw new Error("Please upload a PNG or JPEG picture of your signature.");
  }

  const original = await readFileAsDataUrl(file);
  if (parseSignatureImageDataUrl(original)) return original;

  const image = await loadImage(original);
  const scale = Math.min(
    1,
    MAX_SIGNATURE_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight, 1),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare that picture. Please try drawing instead.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of JPEG_QUALITY_STEPS) {
    const candidate = canvas.toDataURL("image/jpeg", quality);
    if (parseSignatureImageDataUrl(candidate)) return candidate;
  }

  throw new Error("That picture is too large. Please try a smaller photo, or draw your signature.");
}

export default function SignaturePadModal({
  isOpen,
  onClose,
  onSave,
  defaultSignerName = "",
}: SignaturePadModalProps) {
  const titleId = useId();
  const nameFieldId = useId();
  const affirmationId = useId();
  const canvasLabelId = useId();

  const [mode, setMode] = useState<"draw" | "upload">("draw");
  const [signerName, setSignerName] = useState(defaultSignerName);
  // Never pre-affirmed: the affirmation is a legal act the signer performs.
  const [affirmed, setAffirmed] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);

  // Reset on the closed -> open transition. Adjusting state during render is the
  // supported way to react to a prop change; doing it in an effect triggers a
  // cascading render (react-hooks/set-state-in-effect).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setSignerName(defaultSignerName);
      setHasDrawn(false);
      setUploadedDataUrl(null);
      setUploadError(null);
      setAffirmed(false);
    }
  }

  // The canvas only exists while the modal is open, so its 2D context is primed
  // in a ref callback rather than an effect with a timer.
  const attachCanvas = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    if (!node) return;
    const context = node.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, node.width, node.height);
    context.strokeStyle = "#004777"; // Deep state navy
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
  }, []);

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const prepared = await prepareSignatureUpload(file);
      setUploadedDataUrl(prepared);
      setUploadError(null);
    } catch (err) {
      setUploadedDataUrl(null);
      setUploadError(err instanceof Error ? err.message : "Could not use that picture.");
    }
  };

  const handleSave = () => {
    if (!affirmed || !signerName.trim()) return;

    if (mode === "draw") {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) return;
      const signatureDataUrl = canvas.toDataURL("image/png");
      if (!parseSignatureImageDataUrl(signatureDataUrl)) {
        setUploadError("That signature is too large to save. Please clear it and sign again.");
        return;
      }
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
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-base)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
              <PenNib size={20} weight="bold" />
            </div>
            <div>
              <h3 id={titleId} className="text-base font-bold text-[var(--ink-strong)]">
                Official Signature Capture
              </h3>
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
            <label htmlFor={nameFieldId} className="block text-xs font-semibold text-[var(--ink-muted)]">
              Full Legal Signer Name <span className="text-red-500">*</span>
            </label>
            <input
              id={nameFieldId}
              type="text"
              required
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
              aria-pressed={mode === "draw"}
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
              aria-pressed={mode === "upload"}
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
              <p id={canvasLabelId} className="sr-only">
                Signature drawing area. Sign with your finger, a stylus, or the mouse.
              </p>
              <div className="relative overflow-hidden rounded-xl border border-dashed border-[var(--border-strong)] bg-white shadow-inner">
                <canvas
                  ref={attachCanvas}
                  width={460}
                  height={150}
                  role="img"
                  aria-labelledby={canvasLabelId}
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
                    <Image
                      src={uploadedDataUrl}
                      alt="The signature picture you uploaded"
                      width={240}
                      height={96}
                      unoptimized
                      className="max-h-24 w-auto rounded border border-slate-200 bg-white p-2 object-contain"
                    />
                    <label className="cursor-pointer text-xs font-semibold text-sky-600 hover:underline">
                      Choose another file
                      <input
                        type="file"
                        accept={ACCEPTED_UPLOAD_TYPES}
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
                    <span className="text-[11px] text-[var(--ink-muted)]">
                      PNG or JPEG. Large photos are shrunk to {Math.round(SIGNATURE_IMAGE_MAX_BYTES / 1024)} KB.
                    </span>
                    <input
                      type="file"
                      accept={ACCEPTED_UPLOAD_TYPES}
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {uploadError ? (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {uploadError}
            </p>
          ) : null}

          {/* Legal Affirmation Checkbox */}
          <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs leading-relaxed text-[var(--ink-muted)]">
            <input
              id={affirmationId}
              type="checkbox"
              checked={affirmed}
              onChange={(e) => setAffirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
            />
            <label htmlFor={affirmationId}>
              <strong className="text-[var(--ink-strong)]">Legal Audit Affirmation:</strong> I certify under penalty of
              law that I am the individual named above and that this digital signature constitutes my binding legal signature
              under the West Virginia Uniform Electronic Transactions Act (W. Va. Code § 39A-1-1).
            </label>
          </div>
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
