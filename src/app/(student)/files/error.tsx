"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function FilesError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load your files"
      message="This page didn't load. Try again, or go back to your dashboard."
    />
  );
}
