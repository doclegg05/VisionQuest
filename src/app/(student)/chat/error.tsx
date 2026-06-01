"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function ChatError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load your chat"
      message="Sage is having trouble right now. Try again in a moment, or go back to your dashboard."
    />
  );
}
