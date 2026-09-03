"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, ShieldCheck, FileText, Calendar, UserCheck, Warning } from "@phosphor-icons/react";

interface VerificationData {
  verified: boolean;
  documentTitle: string;
  studentName: string;
  studentId?: string;
  county: string;
  programTrack: string;
  status: string;
  submittedAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  auditHash: string;
  legalStandard: string;
  agency: string;
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const hash = searchParams.get("hash") || "";
  const id = searchParams.get("id") || "";

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<VerificationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hash && !id) {
      setError("No verification hash or document ID was provided in the query link.");
      setLoading(false);
      return;
    }

    const query = hash ? `hash=${encodeURIComponent(hash)}` : `id=${encodeURIComponent(id)}`;
    fetch(`/api/verify/document?${query}`)
      .then((res) => {
        if (!res.ok) throw new Error("Document not found or verification hash invalid");
        return res.json();
      })
      .then((result) => {
        setData(result);
      })
      .catch((err) => {
        setError(err.message || "Failed to verify document");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [hash, id]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-600 border-t-transparent" />
        <p className="mt-4 text-sm font-semibold text-slate-700">Verifying state document seal...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border-2 border-red-200 bg-red-50/60 p-8 text-center shadow-lg">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600">
          <Warning size={32} weight="bold" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">Document Verification Failed</h2>
        <p className="mt-2 text-sm text-slate-600">{error || "This document could not be authenticated."}</p>
        <div className="mt-6 rounded-xl border border-red-200 bg-white p-3 text-xs text-slate-500 font-mono break-all">
          Hash: {hash || id || "N/A"}
        </div>
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
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-300 backdrop-blur-sm border border-emerald-300/30">
              <CheckCircle size={14} weight="fill" /> Authentic State Record
            </span>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Official Document Verification</h1>
          </div>
        </div>
        <p className="mt-2 text-xs text-sky-200">
          State of West Virginia • Department of Human Services • SPOKES Adult Education
        </p>
      </div>

      {/* Main Details */}
      <div className="p-8 space-y-6">
        {/* Certificate Card */}
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Document Classification
              </span>
              <h2 className="text-lg font-extrabold text-slate-900">{data.documentTitle}</h2>
              <p className="text-xs text-slate-600 mt-0.5">Program Track: {data.programTrack}</p>
            </div>
            <span className="rounded-xl border border-emerald-300 bg-emerald-600 px-3.5 py-1 text-xs font-bold uppercase text-white shadow-sm">
              Verified
            </span>
          </div>
        </div>

        {/* Verification Grid */}
        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <UserCheck size={16} weight="bold" /> Signer / Participant
            </div>
            <p className="mt-1.5 text-base font-bold text-slate-900">{data.studentName}</p>
            <p className="text-xs text-slate-600">{data.county} County, West Virginia</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Calendar size={16} weight="bold" /> Submission Date & Time
            </div>
            <p className="mt-1.5 text-base font-bold text-slate-900">
              {new Date(data.submittedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            <p className="text-xs text-slate-600 font-mono">
              {new Date(data.submittedAt).toLocaleTimeString("en-US", { timeZoneName: "short" })}
            </p>
          </div>
        </div>

        {/* Reviewer / Counter-Signature Block */}
        {data.reviewedBy && (
          <div className="rounded-xl border-2 border-sky-200 bg-sky-50/50 p-4 text-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-800">
              <ShieldCheck size={16} weight="bold" /> Agency Sign-Off & Verification
            </div>
            <p className="mt-1.5 font-bold text-slate-900">
              Authorized Reviewer: <span className="text-sky-900">{data.reviewedBy}</span>
            </p>
            {data.reviewedAt && (
              <p className="text-xs text-slate-600">
                Approved on: {new Date(data.reviewedAt).toLocaleString("en-US")}
              </p>
            )}
          </div>
        )}

        {/* Cryptographic Audit Trail */}
        <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 text-white">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            Cryptographic SHA-256 Audit Seal
          </p>
          <p className="mt-1.5 font-mono text-xs text-slate-300 break-all select-all">
            {data.auditHash}
          </p>
          <p className="mt-2 text-[11px] text-slate-400">
            Immutable hash computed over student enrollment, legal affirmation, and digital signature records.
          </p>
        </div>

        {/* Legal Certification Statement */}
        <div className="border-t border-slate-200 pt-4 text-center text-[11px] leading-relaxed text-slate-500">
          <p>
            Certified electronic signature and audit record maintained pursuant to the West Virginia Uniform
            Electronic Transactions Act (W. Va. Code § 39A-1-1) and the Federal Electronic Signatures in Global
            and National Commerce Act (E-SIGN, 15 U.S.C. § 7001).
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DocumentVerificationPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 py-12 px-4 sm:px-6">
      <Suspense fallback={<div className="text-center py-20">Loading verification details...</div>}>
        <VerifyContent />
      </Suspense>
    </div>
  );
}
