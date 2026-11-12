import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";

/**
 * Cancellation for model calls (E7). The chat route hands the providers an
 * AbortSignal that fires on a Stop or a dropped connection, so the model host
 * stops generating instead of finishing a reply nobody will read.
 */

/** A request's own abort (the providers' deadlines), joined to the caller's signal. */
export interface LinkedAbort {
  /** Aborts on the caller's signal or on abort() below, whichever comes first. */
  readonly signal: AbortSignal;
  /** Aborts this request only; the caller's signal is untouched. */
  abort(reason?: unknown): void;
}

/**
 * A request's own controller, also aborted by the caller's signal. An already
 * aborted signal throws before anything is sent. AbortSignal.any joins them
 * without adding a listener to the caller's signal, so one turn's signal can
 * serve any number of provider fetches and nothing builds up on it (E9b 7).
 */
export function linkedController(external: AbortSignal | null | undefined): LinkedAbort {
  external?.throwIfAborted();
  const own = new AbortController();
  const signal = external ? AbortSignal.any([own.signal, external]) : own.signal;
  return { signal, abort: (reason?: unknown) => own.abort(reason) };
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * `work`, or an AbortError the moment `signal` aborts, whichever comes first
 * (E9b 5). It cannot stop `work` itself; pass the signal into the work too
 * for that. The listener goes once either side settles.
 */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The turn already ended, so nothing awaits `work`; log a late failure
    // instead of dropping it, by name and code only (no student data).
    void work.catch((error: unknown) => logger.info("Work ended after its turn was stopped", { error: errorForLog(error) }));
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
