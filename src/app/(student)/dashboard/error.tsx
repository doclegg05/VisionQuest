"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load your dashboard"
      message="Your dashboard could not load. Try again; your saved work has not been removed. You can still open Sage."
      backHref="/chat"
      backLabel="Talk to Sage"
    />
  );
}
