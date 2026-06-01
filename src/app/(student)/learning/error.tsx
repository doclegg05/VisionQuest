"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function LearningError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load your learning"
      message="Your courses and certifications are having trouble loading right now. Try again in a moment, or go back to your dashboard."
    />
  );
}
