/**
 * Secret redaction for anything a scorer reports.
 *
 * A benchmark result is one of the most widely published artefacts this repo
 * produces: it is written to disk, uploaded as a CI artifact, pasted into a
 * job step summary, committed to `main` by the nightly workflow, and quoted
 * into a public issue body on regression. A scorer is handed live connection
 * strings and API keys through `ctx.env`, and the most natural thing in the
 * world for it to do on failure is
 *
 *     throw new Error(`connect failed: ${ctx.env.prodReadonlyUrl}`)
 *
 * which would put a production credential in all five places at once, with no
 * malice anywhere in the chain. So every string that leaves a scorer — the
 * error, the skip note, and every string inside `details` — goes through here
 * on the way to the result file.
 *
 * Two passes, because either alone leaves a hole:
 *  1. Named env values. Exact, and the placeholder names the variable, so a
 *     reader knows what was there without seeing it.
 *  2. A generic `scheme://user:password@host` scrub, for credentials this
 *     process never held — a connection string built by a scorer, or one
 *     belonging to a service nobody listed here yet.
 *
 * Values of 7 characters or fewer are never used as needles: a short secret
 * matches inside ordinary words and would mangle the report while hiding
 * nothing worth hiding (a 6-character secret is not a secret).
 */

/** Environment variables whose values must never appear in a result file. */
export const SECRET_ENV_NAMES = Object.freeze([
  "DATABASE_URL",
  "DIRECT_URL",
  "ADMIN_DATABASE_URL",
  "GEMINI_API_KEY",
  "BENCH_PROD_READONLY_URL",
  "CRON_CHECK_DATABASE_URL",
  "TWILIO_AUTH_TOKEN",
]);

/** Shorter than this and a value is too generic to use as a search needle. */
const MIN_SECRET_LENGTH = 8;

/** `postgresql://user:password@host` and friends, credentials only. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {unknown} text
 * @param {Record<string, string|undefined>} [env]
 * @returns {unknown} the redacted string, or the input unchanged when it is
 *   not a string
 */
export function redactSecrets(text, env = process.env) {
  if (typeof text !== "string" || text.length === 0) return text;
  let output = text;

  for (const name of SECRET_ENV_NAMES) {
    const value = env?.[name];
    if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) continue;
    output = output.replace(new RegExp(escapeRegExp(value), "g"), `[redacted:${name}]`);
  }

  // Keep the scheme and the host — those are the parts that make an error
  // message useful — and drop only the credentials.
  output = output.replace(URL_CREDENTIALS, "$1[redacted-credentials]@");

  return output;
}

/**
 * Redact every string inside a value, preserving its shape. Objects and
 * arrays are rebuilt rather than mutated, so a caller's own copy is untouched.
 *
 * This walks the value rather than redacting its serialised form, because
 * string-substituting inside JSON text can only ever produce something that
 * is no longer valid JSON; walking cannot.
 *
 * @param {unknown} value
 * @param {Record<string, string|undefined>} [env]
 */
export function redactDeep(value, env = process.env) {
  if (typeof value === "string") return redactSecrets(value, env);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, env));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactDeep(child, env)])
    );
  }
  return value;
}
