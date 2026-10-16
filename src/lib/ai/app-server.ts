/**
 * Tells eval-only code (the OpenRouter providers and the eval embedding
 * override) that it is running inside the app server, where real student
 * data lives, so it refuses to run.
 *
 * The boot marker is the check that always holds: src/instrumentation.ts sets
 * it first thing when the Node server starts, however it was launched.
 * NEXT_RUNTIME is set in the environment only by the `next` CLI, not by the
 * standalone server.js production runs, and Render sets RENDER only on
 * Render, so the two variables are a second check, not the first.
 */
export const APP_SERVER_MARKERS = ["NEXT_RUNTIME", "RENDER"] as const;

/** Set once at server boot. */
export const APP_SERVER_FLAG = Symbol.for("visionquest.appServer");

/** Called first thing in the server's Node runtime boot (src/instrumentation.ts). */
export function markAppServer(): void {
  Reflect.set(globalThis, APP_SERVER_FLAG, true);
}

/** What marks this process as the app server, or null outside it. */
export function appServerMarker(env: NodeJS.ProcessEnv = process.env): string | null {
  if (Reflect.get(globalThis, APP_SERVER_FLAG) === true) return "the server's boot marker";
  return APP_SERVER_MARKERS.find((name) => Boolean(env[name]?.trim())) ?? null;
}
