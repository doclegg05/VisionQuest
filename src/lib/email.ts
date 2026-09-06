import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { isSafeE2eSeedTarget } from "./e2e-seed-guard";
import { logger } from "./logger";

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * A local file to write outgoing mail to instead of sending it.
 *
 * Set `EMAIL_SINK_DIR` and every send appends one JSON line to
 * `<dir>/outbox.jsonl` and returns. It exists because some flows can only be
 * exercised end to end by reading what was sent: the employer's response link
 * is a capability token that appears in exactly one place — the email — and is
 * stored only as a hash, so nothing else in the system can recover it. Without
 * a sink there is no way for a browser test to open the page an employer opens.
 *
 * REFUSED IN PRODUCTION unless the process can prove it is a hermetic test
 * rig. A file sink on a real deployment would be a silent mail black hole:
 * every crisis notification, every password reset and every employer packet
 * would appear to send and reach nobody.
 *
 * The refusal used to be unconditional on NODE_ENV, and that was right until
 * it was load-bearing in the other direction: CI runs the e2e job against the
 * BUILT standalone server, which hard-sets NODE_ENV=production, so the sink
 * was inert exactly where the connect-journey benchmark needs it and the send
 * route 503'd. The employer's response token exists in one place only — the
 * email — and is stored as a hash, so with no sink there is no way for a
 * browser test to open the page an employer opens.
 *
 * TWO LOCKS, and a real deployment fails the second one even if somebody
 * copies the first into a dashboard:
 *
 *   1. `EMAIL_SINK_ALLOW_HERMETIC=1` — explicit, and named so nobody sets it
 *      believing it does something routine.
 *   2. `DATABASE_URL` passes `isSafeE2eSeedTarget` — the SAME guard that
 *      decides whether the committed-password e2e seed may run. A production
 *      database is remote and not `*_ci`/`*_local`, so it fails this outright.
 *      Reused rather than rewritten: a second, divergent notion of "is this a
 *      throwaway database" is how the two drift apart.
 *
 * WHY THIS AND NOT `rateLimitsDisabled`'s answer, which refuses in production
 * flatly and tells CI to work around it: that switch guards a brute-force
 * control protecting real users, and no env check distinguishes a real deploy
 * from a test rig for it — every deploy has real accounts to protect — so
 * widening it would trade a security control for a benchmark. This is a
 * DESTINATION switch, and the database it is pointed at does distinguish the
 * two. The failure it must prevent (mail vanishing for real people) cannot
 * happen on a database that has no real people in it.
 *
 * Both outcomes are logged, so neither is silent.
 */
function hermeticSinkAllowed(): boolean {
  if (process.env.EMAIL_SINK_ALLOW_HERMETIC !== "1") return false;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  return isSafeE2eSeedTarget(databaseUrl).allowed;
}

function getSinkPath(): string | null {
  const dir = process.env.EMAIL_SINK_DIR;
  if (!dir) return null;
  if (process.env.NODE_ENV !== "production") return path.join(dir, "outbox.jsonl");
  if (!hermeticSinkAllowed()) {
    warnSinkRefusedOnce();
    return null;
  }
  warnHermeticSinkOnce();
  return path.join(dir, "outbox.jsonl");
}

/** Once per process: the environment is static, so repeating the line is noise. */
let refusalAnnounced = false;
let hermeticAnnounced = false;

function warnSinkRefusedOnce(): void {
  if (refusalAnnounced) return;
  refusalAnnounced = true;
  logger.warn(
    "EMAIL_SINK_DIR is set but ignored in production; mail is being sent normally. " +
      "A hermetic test rig must set EMAIL_SINK_ALLOW_HERMETIC=1 AND point DATABASE_URL " +
      "at a local or *_ci/*_local database.",
  );
}

function warnHermeticSinkOnce(): void {
  if (hermeticAnnounced) return;
  hermeticAnnounced = true;
  logger.warn(
    "email_sink_hermetic: NODE_ENV=production but mail is being diverted to a file. " +
      "This is only possible against a local/CI database with EMAIL_SINK_ALLOW_HERMETIC=1. " +
      "If you are seeing this on a real deployment, mail is NOT reaching anyone.",
  );
}

/** Whether mail is being diverted to a file rather than sent. */
export function isEmailSinkActive(): boolean {
  return getSinkPath() !== null;
}

function getMailerConfig() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !from) {
    return null;
  }

  return {
    host,
    port: Number(port),
    from,
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
  };
}

/**
 * True when a send will go somewhere.
 *
 * The sink counts. Callers use this to refuse BEFORE doing work they cannot
 * undo — `sendConnection` checks it before it spends one of an employer's three
 * weekly packets — and under a sink the send genuinely will not fail, so
 * reporting "not configured" would make every such flow untestable.
 */
export function isEmailDeliveryConfigured(): boolean {
  return isEmailSinkActive() || Boolean(getMailerConfig());
}

/**
 * One line the first time mail is diverted, so a non-production deploy that
 * happens to carry `EMAIL_SINK_DIR` is not a silent black hole.
 *
 * `isEmailDeliveryConfigured()` returns TRUE under a sink, which is right for
 * the flows that check it and wrong as the only signal an operator ever gets:
 * staging would report mail working while nobody received any. Warned once
 * rather than per send, because a benchmark run sends dozens.
 */
let sinkAnnounced = false;

export async function sendEmail(payload: EmailPayload) {
  const sinkPath = getSinkPath();
  if (sinkPath) {
    if (!sinkAnnounced) {
      sinkAnnounced = true;
      logger.warn("email_sink_active", {
        sinkPath,
        note: "EMAIL_SINK_DIR is set: outgoing mail is being written to a file, not sent.",
      });
    }
    mkdirSync(path.dirname(sinkPath), { recursive: true });
    appendFileSync(
      sinkPath,
      `${JSON.stringify({ ...payload, sentAt: new Date().toISOString() })}\n`,
    );
    return;
  }

  const config = getMailerConfig();

  if (!config) {
    throw new Error("Email delivery is not configured.");
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: config.user && config.pass
      ? {
          user: config.user,
          pass: config.pass,
        }
      : undefined,
  });

  await transporter.sendMail({
    from: config.from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
}
