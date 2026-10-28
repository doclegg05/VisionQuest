"use client";

import React, { useRef } from "react";
import { X, Printer, DownloadSimple, PenNib } from "@phosphor-icons/react";

interface PdfPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  title: string;
  studentName: string;
  status: string;
  onCounterSign?: () => void;
}

export default function PdfPreviewModal({
  isOpen,
  onClose,
  fileId,
  title,
  studentName,
  status,
  onCounterSign,
}: PdfPreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  if (!isOpen || !fileId) return null;

  const downloadUrl = `/api/files/download?id=${fileId}`;

  const handlePrint = () => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      // If cross-origin or sandbox blocks direct iframe print, open in print window
      window.open(downloadUrl, "_blank");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6 backdrop-blur-sm animate-fade-in">
      <div className="flex h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-2xl">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)] px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h3 className="truncate text-base font-bold text-[var(--ink-strong)]">{title}</h3>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  status === "approved"
                    ? "bg-success-soft text-success"
                    : "bg-warning-soft text-warning"
                }`}
              >
                {status === "approved" ? "State Certified & Approved" : "Pending Review"}
              </span>
            </div>
            <p className="mt-0.5 text-xs font-medium text-[var(--ink-muted)]">
              Student: <strong className="text-[var(--ink-strong)]">{studentName}</strong> • Official West Virginia SPOKES Document
            </p>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-2">
            {status !== "approved" && onCounterSign && (
              <button
                type="button"
                onClick={onCounterSign}
                className="pointer-coarse:min-h-11 flex items-center gap-1.5 rounded-xl border border-info bg-info px-3.5 py-2 text-xs font-bold text-on-info shadow-sm transition-all hover:bg-info active:scale-95 cursor-pointer"
              >
                <PenNib size={15} weight="bold" />
                Counter-Sign & Approve
              </button>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="pointer-coarse:min-h-11 flex items-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-base)] px-3.5 py-2 text-xs font-bold text-[var(--ink-strong)] shadow-sm transition-all hover:bg-[var(--surface-muted)] active:scale-95 cursor-pointer"
              title="Print official document"
            >
              <Printer size={16} weight="bold" />
              Print
            </button>

            <a
              href={downloadUrl}
              download
              className="pointer-coarse:min-h-11 flex items-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-base)] px-3.5 py-2 text-xs font-bold text-[var(--ink-strong)] shadow-sm transition-all hover:bg-[var(--surface-muted)] active:scale-95"
              title="Download PDF file"
            >
              <DownloadSimple size={16} weight="bold" />
              Download
            </a>

            <button
              type="button"
              onClick={onClose}
              className="pointer-coarse:min-h-11 rounded-xl border border-[var(--border)] p-2 text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)] cursor-pointer ml-1"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* PDF Viewer Body */}
        <div className="relative flex-1 bg-surface-muted">
          <iframe
            ref={iframeRef}
            src={`${downloadUrl}#toolbar=1`}
            title={title}
            className="h-full w-full border-none"
          />
        </div>
      </div>
    </div>
  );
}
