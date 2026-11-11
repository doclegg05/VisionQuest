/**
 * Cancellation for model calls (E7). The chat route hands the providers an
 * AbortSignal that fires on a Stop or a dropped connection, so the model host
 * stops generating instead of finishing a reply nobody will read.
 */

/**
 * A request's own controller (the providers abort it on their deadlines),
 * also aborted by the caller's signal. An already aborted signal throws
 * before anything is sent.
 */
export function linkedController(external: AbortSignal | null | undefined): AbortController {
  external?.throwIfAborted();
  const controller = new AbortController();
  external?.addEventListener("abort", () => controller.abort(external.reason), { once: true });
  return controller;
}
