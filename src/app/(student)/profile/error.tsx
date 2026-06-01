"use client";

import { SegmentError } from "@/components/ui/SegmentError";

export default function ProfileError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="We couldn't load your profile"
      message="Your profile is having trouble loading right now. Try again in a moment, or go back to your dashboard."
    />
  );
}
