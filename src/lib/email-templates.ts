/**
 * Email templates for VisionQuest notifications.
 * Uses inline styles for maximum email client compatibility.
 */

/**
 * Build an HTML email for coaching notifications.
 * All styles are inline — no external CSS dependencies.
 */
export function buildNotificationEmail(
  title: string,
  body: string,
  actionUrl: string,
): string {
  const appBaseUrl = process.env.APP_BASE_URL ?? actionUrl;
  const settingsUrl = `${appBaseUrl}/settings`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6d28d9 0%,#0d9488 100%);padding:28px 32px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">VisionQuest</p>
              <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">Your AI Coach, Sage</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#374151;">${escapeHtml(body)}</p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px;background-color:#6d28d9;">
                    <a href="${escapeHtml(actionUrl)}"
                       style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                      Open VisionQuest
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                You received this message because you are enrolled in a VisionQuest program.<br />
                To change notification settings,
                <a href="${escapeHtml(settingsUrl)}" style="color:#6d28d9;text-decoration:underline;">visit your Settings page</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
