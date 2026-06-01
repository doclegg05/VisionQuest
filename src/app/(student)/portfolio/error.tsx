"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function PortfolioError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load your portfolio"
      message="Your portfolio is having trouble loading right now. Try again in a moment, or go back to your dashboard."
    />
  );
}
