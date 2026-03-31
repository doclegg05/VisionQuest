/**
 * SMS delivery via Twilio REST API.
 * Twilio credentials are optional — if not configured, SMS silently degrades to no-op.
 */
import { logger } from "./logger";

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
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Twilio SMS delivery failed", {
        status: response.status,
        to,
        error: errorText,
      });
      return false;
    }

    logger.info("SMS sent successfully", { to });
    return true;
  } catch (err) {
    logger.error("Twilio SMS delivery threw an error", { to, error: String(err) });
    return false;
  }
}
