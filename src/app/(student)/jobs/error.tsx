"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function JobsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load jobs"
      message="The job board is having trouble loading right now. Try again in a moment, or go back to your dashboard."
    />
  );
}
