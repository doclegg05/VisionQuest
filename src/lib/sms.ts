/**
 * SMS delivery via Twilio REST API.
 * Twilio credentials are optional — if not configured, SMS silently degrades to no-op.
 */
import { logger } from "./logger";
import { redactContactInfo } from "./log-redaction";

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return null;
  }

  return { accountSid, authToken, fromNumber };
}

export function isSmsDeliveryConfigured(): boolean {
  return Boolean(getTwilioConfig());
}

/**
 * How long one Twilio POST may take.
 *
 * Ten seconds against the nudge runner's 15s deadline margin: the margin has
 * to cover this send AND the `OutboundMessage` row update that follows it, so
 * the send's own bound must be comfortably the smaller of the two.
 *
 * Read per call rather than captured at module load, so a test can shorten it
 * without waiting ten real seconds to prove the timeout exists — and so an
 * operator can lengthen it from the environment if Twilio is having a slow
 * day, without a deploy. A non-numeric value falls back to the default rather
 * than producing a `NaN` deadline, which `AbortSignal.timeout` would reject.
 */
export const SEND_TIMEOUT_MS = 10_000;

function sendTimeoutMs(): number {
  const raw = Number(process.env.SMS_SEND_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : SEND_TIMEOUT_MS;
}

/**
 * Send an SMS via Twilio REST API.
 * Returns true on success, false if Twilio is not configured or delivery fails.
 */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const config = getTwilioConfig();

  if (!config) {
    logger.warn("SMS delivery skipped: Twilio credentials not configured");
    return false;
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const credentials = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  const params = new URLSearchParams({
    To: to,
    From: config.fromNumber,
    Body: body,
  });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      // Without this, `fetch` waits as long as the socket stays open, and
      // every caller's own bound becomes a claim rather than a guarantee.
      // The nudge runner's 15s deadline margin is sized for exactly one
      // in-flight send plus its row update, so an untimed send could hold the
      // run lock past the transaction timeout it was there to stay inside.
      // The catch below turns the abort into `false`, which is what every
      // caller already handles.
      signal: AbortSignal.timeout(sendTimeoutMs()),
    });

    // The recipient number never reaches the logs, and Twilio quotes it inside
    // its own error bodies, so provider text is redacted before it is logged
    // (.claude/rules/security.md, Data Privacy).
    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Twilio SMS delivery failed", {
        status: response.status,
        error: redactContactInfo(errorText),
      });
      return false;
    }

    logger.info("SMS sent successfully");
    return true;
  } catch (err) {
    logger.error("Twilio SMS delivery threw an error", {
      error: redactContactInfo(String(err)),
    });
    return false;
  }
}
