"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function GoalsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load your goals"
      message="This page didn't load. Try again, or go back to your dashboard."
    />
  );
}
