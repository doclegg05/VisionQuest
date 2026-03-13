interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
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

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(getMailerConfig());
}

export async function sendEmail(payload: EmailPayload) {
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
