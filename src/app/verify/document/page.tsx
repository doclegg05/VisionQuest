"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, ShieldCheck, FileText, Fingerprint, Warning } from "@phosphor-icons/react";

/**
 * What this page may and may not say.
 *
 * It is reached by scanning the QR on a printed packet, so its reader is
 * holding the document and can see the participant's name on it. The page
 * therefore never repeats identity — no name, no login username, no county,
 * no reviewer — because the reader may be anyone who picked the paper up, and
 * for this population "enrolled in SPOKES in <county>" discloses benefits
 * status. See the doc block on src/app/api/verify/document/route.ts.
 *
 * It also may not describe the digest as more than it is. The previous copy
 * called it an "immutable hash computed over student enrollment, legal
 * affirmation, and digital signature records", which was computed over none of
 * those. It is a SHA-256 of the PDF bytes, and the page says exactly that.
 */

interface VerificationSuccess {
  verified: true;
  documentType: string;
  issuedAt: string;
  documentDigest: string | null;
  issuingAgency: string;
  legalStandard: string;
}

interface VerificationFailure {
  verified: false;
  reason: string;
  error: string;
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  // A missing token is knowable before render, so it is derived rather than
  // written into state from inside the effect (which would cascade a render).
  const [pending, setPending] = useState(Boolean(token));
  const [data, setData] = useState<VerificationSuccess | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    fetch(`/api/verify/document?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const result = (await res.json()) as VerificationSuccess | VerificationFailure;
        if (cancelled) return;
        if (!res.ok || result.verified !== true) {
          setFetchError(
            (result as VerificationFailure).error ||
              "This document could not be matched to a SPOKES record.",
          );
          return;
        }
        setData(result);
      })
      .catch(() => {
        if (!cancelled) {
          setFetchError("We could not reach the verification service. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const loading = pending;
  const error = token
    ? fetchError
    : "This link has no verification code. Scan the QR code printed on the document itself.";

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-600 border-t-transparent" />
        <p className="mt-4 text-sm font-semibold text-slate-700">Checking this document...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border-2 border-red-200 bg-red-50/60 p-8 text-center shadow-lg">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600">
          <Warning size={32} weight="bold" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">We could not verify this document</h2>
        <p className="mt-2 text-sm text-slate-600">
          {error || "This document could not be matched to a SPOKES record."}
        </p>
        <p className="mt-4 text-xs text-slate-500">
          To confirm a document by hand, contact the SPOKES program office.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-3xl border-2 border-emerald-300 bg-white shadow-2xl">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-teal-800 via-sky-800 to-indigo-900 px-8 py-8 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-md">
            <ShieldCheck size={32} weight="fill" className="text-emerald-300" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/20 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-300 backdrop-blur-sm">
              <CheckCircle size={14} weight="fill" /> Issued by this program
            </span>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Document Verification</h1>
          </div>
        </div>
        <p className="mt-2 text-xs text-sky-200">{data.issuingAgency}</p>
      </div>

      {/* Main Details */}
      <div className="space-y-6 p-8">
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                What we checked
              </span>
              <h2 className="text-lg font-extrabold text-slate-900">{data.documentType}</h2>
              <p className="mt-1 text-sm text-slate-700">
                This program issued this document and still holds the record for it.
              </p>
            </div>
            <span className="rounded-xl border border-emerald-300 bg-emerald-600 px-3.5 py-1 text-xs font-bold uppercase text-white shadow-sm">
              Verified
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            <FileText size={16} weight="bold" /> Date issued
          </div>
          <p className="mt-1.5 text-base font-bold text-slate-900">
            {new Date(data.issuedAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>

        {/* Document fingerprint. Rendered only when we actually hold one — an
            empty seal is the failure mode this page was rewritten to remove. */}
        {data.documentDigest && (
          <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 text-white">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
              <Fingerprint size={16} weight="bold" /> Document fingerprint (SHA-256)
            </p>
            <p className="mt-1.5 select-all break-all font-mono text-xs text-slate-300">
              {data.documentDigest}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              This is the SHA-256 fingerprint of the PDF file this program issued. It matches the
              fingerprint printed on the document. If the two differ, the file you have is not the
              one we issued.
            </p>
          </div>
        )}

        {/* What this page does not tell you */}
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-xs leading-relaxed text-slate-600">
          <p className="font-bold uppercase tracking-wider text-sky-800">Scope of this check</p>
          <p className="mt-1.5">
            This page confirms the document, not the person. It does not report anyone&rsquo;s name,
            enrollment or program status. Staff who need those details sign in to the SPOKES portal,
            where every look at a student record is logged.
          </p>
        </div>

        <div className="border-t border-slate-200 pt-4 text-center text-[11px] leading-relaxed text-slate-500">
          <p>Electronic signature record maintained pursuant to the {data.legalStandard}.</p>
        </div>
      </div>
    </div>
  );
}

export default function DocumentVerificationPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 px-4 py-12 sm:px-6">
      <Suspense fallback={<div className="py-20 text-center">Loading verification details...</div>}>
        <VerifyContent />
      </Suspense>
    </div>
  );
}
