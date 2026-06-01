"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function ResourcesError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load resources"
      message="Resources are having trouble loading right now. Try again in a moment, or go back to your dashboard."
    />
  );
}
