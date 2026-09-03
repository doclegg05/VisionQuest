"use client";

import React, { useRef, useState } from "react";
import { X, Printer, DownloadSimple, CheckCircle, PenNib, PaperPlaneTilt } from "@phosphor-icons/react";

interface PdfPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  title: string;
  studentName: string;
  studentId?: string;
  submissionId?: string;
  status: string;
  onCounterSign?: () => void;
}

export default function PdfPreviewModal({
  isOpen,
  onClose,
  fileId,
  title,
  studentName,
  studentId,
  submissionId,
  status,
  onCounterSign,
}: PdfPreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);

  if (!isOpen || !fileId) return null;

  const downloadUrl = `/api/files/download?id=${fileId}`;

  const handleDispatchCaseworker = async () => {
    if (!studentId) return;
    const email = window.prompt("Enter DHHR / WorkForce Caseworker Email to dispatch certified packet:", "caseworker@wv.gov");
    if (!email || !email.includes("@")) return;

    setDispatching(true);
    try {
      const res = await fetch(`/api/teacher/students/${studentId}/forms/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          caseworkerEmail: email,
          caseworkerName: "DHHR Regional Worker",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDispatchSuccess(`Packet dispatched to ${email}`);
        setTimeout(() => setDispatchSuccess(null), 4000);
      } else {
        alert(data.error || "Failed to dispatch to caseworker");
      }
    } catch {
      alert("Error sending packet to caseworker");
    } finally {
      setDispatching(false);
    }
  };

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
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
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
                className="flex items-center gap-1.5 rounded-xl border border-sky-600 bg-sky-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-sky-700 active:scale-95 cursor-pointer"
              >
                <PenNib size={15} weight="bold" />
                Counter-Sign & Approve
              </button>
            )}

            {studentId && (
              <button
                type="button"
                onClick={handleDispatchCaseworker}
                disabled={dispatching}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-600 bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
                title="Send certified packet directly to student's DHHR caseworker"
              >
                <PaperPlaneTilt size={15} weight="bold" />
                {dispatching ? "Sending..." : "Send to Caseworker"}
              </button>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-base)] px-3.5 py-2 text-xs font-bold text-[var(--ink-strong)] shadow-sm transition-all hover:bg-[var(--surface-muted)] active:scale-95 cursor-pointer"
              title="Print official document"
            >
              <Printer size={16} weight="bold" />
              Print
            </button>

            <a
              href={downloadUrl}
              download
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-base)] px-3.5 py-2 text-xs font-bold text-[var(--ink-strong)] shadow-sm transition-all hover:bg-[var(--surface-muted)] active:scale-95"
              title="Download PDF file"
            >
              <DownloadSimple size={16} weight="bold" />
              Download
            </a>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[var(--border)] p-2 text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)] cursor-pointer ml-1"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {dispatchSuccess && (
          <div className="bg-emerald-600 px-6 py-2 text-xs font-bold text-white text-center shadow-inner animate-fade-in">
            ✓ {dispatchSuccess} and recorded in official Case Notes.
          </div>
        )}

        {/* PDF Viewer Body */}
        <div className="relative flex-1 bg-slate-900/10 dark:bg-black/30">
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
