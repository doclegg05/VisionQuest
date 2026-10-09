"use client";

export default function MonthlyReportExporter({ regionId }: { regionId: string }) {
  return (
    <a
      href={`/api/coordinator/reports/monthly/${regionId}`}
      download
      className="primary-button inline-flex items-center gap-2 px-4 py-2 text-sm pointer-coarse:min-h-11"
    >
      Export monthly CSV
    </a>
  );
}
