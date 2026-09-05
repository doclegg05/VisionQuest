"use client";

import { useEffect, useState } from "react";

import { SharedWithEmployers, type SharedPacket } from "./SharedWithEmployers";

/**
 * Loads the student's own disclosure log (GET /api/connect/shared) and hands
 * it to the presentational list — the same panel/list split SageMemoryPanel
 * and SageMemoryList use on this page.
 *
 * A load failure renders the empty state's honest wording rather than a blank
 * area: this is the page a student comes to specifically to find out what was
 * shared, and silence would be the wrong answer to that question.
 */
export function SharedWithEmployersPanel() {
  const [packets, setPackets] = useState<SharedPacket[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/connect/shared")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (!cancelled) setPackets(json?.data?.packets ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("We could not load this right now. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <SharedWithEmployers packets={packets} />
      {error && (
        <p className="mb-6 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
