import { Suspense } from "react";
import type { Metadata } from "next";
import IntakeClient from "./IntakeClient";

export const metadata: Metadata = {
  title: "SPOKES Student Intake & Enrollment | VisionQuest",
  description:
    "Complete your digital enrollment into the SPOKES workforce development program. Fast, secure, and mobile-friendly.",
};

export default function IntakePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4 text-[var(--ink-muted)]">
          <p>Loading enrollment portal...</p>
        </div>
      }
    >
      <IntakeClient />
    </Suspense>
  );
}
