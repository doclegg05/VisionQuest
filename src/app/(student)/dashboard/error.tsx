"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load your dashboard"
      message="This page didn't load. Try again in a moment."
      backHref="/chat"
      backLabel="Talk to Sage"
    />
  );
}
