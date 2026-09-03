"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Printer, X, QrCode as QrIcon, CheckCircle } from "@phosphor-icons/react";

interface ClassIntakeFlyerModalProps {
  isOpen: boolean;
  onClose: () => void;
  classId: string;
  className: string;
  countyName?: string;
}

export default function ClassIntakeFlyerModal({
  isOpen,
  onClose,
  classId,
  className,
  countyName = "",
}: ClassIntakeFlyerModalProps) {
  const [intakeUrl, setIntakeUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const origin = typeof window !== "undefined" ? window.location.origin : "https://visionquest.onrender.com";
    const countyParam = countyName ? `&county=${encodeURIComponent(countyName)}` : "";
    const url = `${origin}/intake?classId=${classId}${countyParam}`;
    setIntakeUrl(url);

    QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: {
        dark: "#007baf", // SPOKES primary blue
        light: "#ffffff",
      },
    })
      .then((data) => setQrDataUrl(data))
      .catch(() => {});
  }, [isOpen, classId, className, countyName]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(intakeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      {/* Printable Flyer (Visible on screen and during print) */}
      <div className="relative w-full max-w-lg rounded-3xl border border-[var(--border)] bg-[var(--surface-card)] p-6 shadow-2xl sm:p-8">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-full p-2 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] print:hidden"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--accent)] print:text-black">
          <QrIcon size={18} weight="bold" /> SPOKES Classroom Intake & Enrollment
        </div>

        <h2 className="mt-2 font-display text-2xl font-bold text-[var(--ink-strong)]">
          {className}
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Students can scan this QR code on their phone to enroll immediately without manual instructor typing.
        </p>

        {/* QR Code Card */}
        <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-white p-6 shadow-inner">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt={`Intake QR Code for ${className}`}
              className="h-56 w-56 object-contain"
            />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center text-xs text-[var(--ink-muted)]">
              Generating QR Code...
            </div>
          )}
          <p className="mt-3 text-center text-xs font-semibold text-[var(--ink-muted)]">
            Scan with smartphone camera to enroll
          </p>
        </div>

        {/* Direct Link Input */}
        <div className="mt-5 print:hidden">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Direct Web Link
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={intakeUrl}
              className="field w-full truncate px-3 py-2 text-xs font-mono text-[var(--ink-muted)]"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-soft)]"
            >
              {copied ? (
                <>
                  <CheckCircle size={14} className="text-emerald-600" weight="fill" /> Copied
                </>
              ) : (
                <>
                  <Copy size={14} /> Copy
                </>
              )}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap gap-3 print:hidden">
          <button
            type="button"
            onClick={handlePrint}
            className="primary-button flex flex-1 items-center justify-center gap-2 py-3 text-sm font-semibold"
          >
            <Printer size={18} weight="bold" /> Print Intake Flyer
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-muted)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
