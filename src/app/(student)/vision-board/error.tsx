"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function VisionBoardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load your vision board"
      message="Your vision board is having trouble loading right now. Try again in a moment, or go back to your dashboard."
    />
  );
}
