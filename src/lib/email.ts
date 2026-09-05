import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

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
 * REFUSED IN PRODUCTION, unconditionally. A file sink there would be a silent
 * mail black hole: every crisis notification, every password reset and every
 * employer packet would appear to send and reach nobody. The check is on
 * NODE_ENV rather than on the path or a flag, because the failure is severe
 * enough that it should not depend on somebody configuring the guard correctly.
 */
function getSinkPath(): string | null {
  const dir = process.env.EMAIL_SINK_DIR;
  if (!dir) return null;
  if (process.env.NODE_ENV === "production") return null;
  return path.join(dir, "outbox.jsonl");
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

export async function sendEmail(payload: EmailPayload) {
  const sinkPath = getSinkPath();
  if (sinkPath) {
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
