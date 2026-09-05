"use client";

import { useState } from "react";

/**
 * "Download this week's ready students" — the two-step WorkForce WV export
 * (UX review CRITICAL #1).
 *
 * This used to be a bare link straight at the export route. One tap put a file
 * of TANF students' names on disk and a disclosure in the audit log, with
 * nothing shown first, and the copy said "send" when the route only downloads
 * a file the instructor still has to relay by hand.
 *
 * So: preview, then confirm. The preview names exactly who is included and
 * which fields go out, and says how many students were left out and why. Only
 * the confirmed download runs the export, and only that writes the audit row.
 *
 * The download is a POST, so it cannot be triggered by a cross-site GET or a
 * stray image tag. A plain <form method="POST"> would send form-encoded data
 * that the route's Zod `parseBody` does not accept, so the confirm does a
 * fetch and turns the response into an object-URL download — which also keeps
 * the error path on the page instead of navigating away from it.
 */

interface PreviewResponse {
  className: string;
  count: number;
  names: string[];
  fields: string[];
  excludedNotReady: number;
  excludedNoConsent: number;
}

export interface BatchWorkforceButtonProps {
  classes: Array<{ id: string; name: string }>;
}

/** How many names the dialog lists before summarising the rest. */
const NAMES_SHOWN = 10;

export function BatchWorkforceButton({ classes }: BatchWorkforceButtonProps) {
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function loadPreview() {
    if (!classId) return;
    setPending(true);
    setError(null);
    setPreview(null);
    try {
      const response = await fetch(
        `/api/teacher/connect/batch-workforce-wv/preview?classId=${encodeURIComponent(classId)}`,
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not check that class. Try again.");
        return;
      }
      setPreview(body as PreviewResponse);
    } catch {
      setError("Could not check that class. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function confirmDownload() {
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch("/api/teacher/connect/batch-workforce-wv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Could not make that file. Try again.");
        return;
      }

      // The filename the server chose, so the audit row and the file on disk
      // carry the same name.
      const disposition = response.headers.get("content-disposition") ?? "";
      const named = /filename="([^"]+)"/u.exec(disposition)?.[1];

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = named ?? "workforce-wv.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setDone(true);
      setPreview(null);
    } catch {
      setError("Could not make that file. Check your connection and try again.");
    } finally {
      setDownloading(false);
    }
  }

  if (classes.length === 0) return null;

  return (
    <section
      aria-labelledby="batch-workforce-heading"
      className="theme-card rounded-xl p-5"
    >
      <h2 id="batch-workforce-heading" className="text-base font-semibold text-[var(--ink-strong)]">
        Send students to WorkForce WV
      </h2>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        This makes a file of the students in one class who are ready for work and have said yes to
        being sent to employers. You download it, then email it to your WorkForce WV contact
        yourself. Nothing is sent for you.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm font-medium text-[var(--ink-strong)]">
          Class
          <select
            value={classId}
            onChange={(event) => {
              setClassId(event.target.value);
              setPreview(null);
              setDone(false);
            }}
            className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-[var(--surface-base)] px-3 py-2 text-sm text-[var(--ink-strong)]"
          >
            {classes.map((spokesClass) => (
              <option key={spokesClass.id} value={spokesClass.id}>
                {spokesClass.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void loadPreview()}
          disabled={pending || !classId}
          className="min-h-[44px] rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] disabled:opacity-60"
        >
          {pending ? "Checking..." : "Download this week's ready students"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--ink-strong)]">
          {error}
        </p>
      )}

      {done && (
        <p role="status" className="mt-3 text-sm text-[var(--ink-strong)]">
          The file downloaded. Email it to your WorkForce WV contact.
        </p>
      )}

      {preview && (
        <div className="mt-4 rounded-lg border border-[var(--border)] p-4">
          <h3 className="text-sm font-semibold text-[var(--ink-strong)]">
            Check this before you download
          </h3>

          {preview.count === 0 ? (
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              No students in {preview.className} are in this file yet.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-[var(--ink-strong)]">
                This file will include {preview.count}{" "}
                {preview.count === 1 ? "student" : "students"}:
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-[var(--ink-muted)]">
                {preview.names.slice(0, NAMES_SHOWN).map((name) => (
                  <li key={name}>{name}</li>
                ))}
                {preview.names.length > NAMES_SHOWN && (
                  <li>and {preview.names.length - NAMES_SHOWN} more</li>
                )}
              </ul>
            </>
          )}

          <p className="mt-3 text-sm text-[var(--ink-strong)]">With these fields:</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{preview.fields.join(", ")}.</p>

          {(preview.excludedNotReady > 0 || preview.excludedNoConsent > 0) && (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              Left out: {preview.excludedNotReady} not ready for work yet,{" "}
              {preview.excludedNoConsent} have not said yes to being sent to employers.
            </p>
          )}

          {preview.count > 0 && (
            <button
              type="button"
              onClick={() => void confirmDownload()}
              disabled={downloading}
              className="mt-4 min-h-[44px] w-full rounded-lg bg-[var(--accent-green)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
            >
              {downloading ? "Making the file..." : "Yes, download the file"}
            </button>
          )}

          <p className="mt-3 text-sm text-[var(--ink-muted)]">
            After it downloads, email it to your WorkForce WV Business Services contact.
          </p>
        </div>
      )}
    </section>
  );
}
