"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  SAGE_NOTICE_ACK_BUTTON,
  SAGE_NOTICE_ACK_FAILED,
  SAGE_NOTICE_ACK_PENDING,
  SAGE_NOTICE_ACK_SIGNED_OUT,
  SAGE_NOTICE_ACK_STALE,
  SAGE_NOTICE_SIGN_IN_AGAIN,
} from "@/lib/about-sage/notice";
import { followOutcome, postAcknowledgement, type AckOutcome } from "./acknowledge";

const MESSAGES: Record<Exclude<AckOutcome, "saved">, string> = {
  failed: SAGE_NOTICE_ACK_FAILED,
  stale: SAGE_NOTICE_ACK_STALE,
  "signed-out": SAGE_NOTICE_ACK_SIGNED_OUT,
};

/** The line under the button after a tap that did not go through. Same look as ChangePasswordForm's error. */
export function AcknowledgeMessage({ outcome }: { outcome: AckOutcome | null }) {
  if (outcome === null || outcome === "saved") return null;
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
      <WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />
      <span>
        {MESSAGES[outcome]}
        {outcome === "signed-out" && (
          <>
            {" "}
            <Link href="/" className="inline-flex min-h-11 items-center font-semibold underline">
              {SAGE_NOTICE_SIGN_IN_AGAIN}
            </Link>
          </>
        )}
      </span>
    </p>
  );
}

/** Records the acknowledgement, then goes on to the app (the layout may ask for recovery questions next). */
export function AcknowledgeButton({ version }: { version: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<AckOutcome | null>(null);
  // A second tap can land before React re-renders the disabled button.
  const inFlight = useRef(false);

  async function handleClick() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setOutcome(null);
    const result = await postAcknowledgement(version);
    followOutcome(result, router);
    if (result === "saved") return;
    inFlight.current = false;
    setPending(false);
    setOutcome(result);
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
      <AcknowledgeMessage outcome={outcome} />
    </div>
  );
}
