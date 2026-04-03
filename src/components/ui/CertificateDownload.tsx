"use client";

import { useState } from "react";
import { generateCertificatePDF, type CertificateData } from "@/lib/certificate-generator";

interface CertificateDownloadProps {
  studentName: string;
  certificateType: string;
  dateEarned: string;
  disabled?: boolean;
}

export default function CertificateDownload({
  studentName,
  certificateType,
  dateEarned,
  disabled,
}: CertificateDownloadProps) {
  const [generating, setGenerating] = useState(false);

  async function handleDownload() {
    setGenerating(true);
    try {
      const blob = await generateCertificatePDF({
        studentName,
        certificateType,
        dateEarned,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${certificateType.replace(/\s+/g, "_")}_${studentName.replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Certificate generation failed:", err);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={disabled || generating}
      className="inline-flex items-center gap-1.5 theme-card-subtle rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--accent-secondary)] transition-colors hover:bg-[rgba(15,154,146,0.06)] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      📄 {generating ? "Generating..." : "Download Certificate"}
    </button>
  );
}
