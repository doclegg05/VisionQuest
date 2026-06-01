"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function WelcomeError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load this page"
      message="Something went wrong getting you started. Try again in a moment, or go back to your dashboard."
    />
  );
}
