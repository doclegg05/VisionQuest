"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SAGE_NOTICE_ACK_BUTTON,
  SAGE_NOTICE_ACK_FAILED,
  SAGE_NOTICE_ACK_PENDING,
  SAGE_NOTICE_VERSION,
} from "@/lib/about-sage/notice";

async function postAcknowledgement(): Promise<boolean> {
  try {
    const res = await fetch("/api/sage-notice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: SAGE_NOTICE_VERSION }),
    });
    return res.ok;
  } catch {
    // A network failure: the student sees SAGE_NOTICE_ACK_FAILED and can tap again.
    return false;
  }
}

/** Records the acknowledgement, then goes on to the app (the layout may ask for recovery questions next). */
export function AcknowledgeButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // A second tap can land before React re-renders the disabled button.
  const inFlight = useRef(false);

  async function handleClick() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    const ok = await postAcknowledgement();
    if (ok) {
      router.replace("/dashboard");
      return;
    }
    inFlight.current = false;
    setPending(false);
    setFailed(true);
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="primary-button min-h-11 w-full px-6 py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? SAGE_NOTICE_ACK_PENDING : SAGE_NOTICE_ACK_BUTTON}
      </button>
      {failed && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {SAGE_NOTICE_ACK_FAILED}
        </p>
      )}
    </div>
  );
}
