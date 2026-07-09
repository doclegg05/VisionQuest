"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function CareerProfileError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load your Career DNA"
      message="This page didn't load. Try again, or go back to Career."
      backHref="/career"
      backLabel="Back to Career"
    />
  );
}
