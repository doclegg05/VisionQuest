/**
 * Job handler registry — registers all background job handlers.
 * Import this module once at app startup to ensure handlers are available.
 */
import { registerJobHandler } from "./jobs";
import { handlePostResponse } from "./chat/post-response";
import { isEmailDeliveryConfigured, sendEmail } from "./email";
import { logger } from "./logger";

// Chat post-response processing (goal extraction, XP, stage updates, title)
registerJobHandler("chat_post_response", async (payload) => {
  await handlePostResponse(payload as unknown as Parameters<typeof handlePostResponse>[0]);
});

registerJobHandler("send_email", async (payload) => {
  const to = typeof payload.to === "string" ? payload.to.trim() : "";
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const html = typeof payload.html === "string" ? payload.html : undefined;

  if (!to || !subject || !text) {
    throw new Error("Invalid send_email payload.");
  }

  if (!isEmailDeliveryConfigured()) {
    logger.info("Skipping email job because SMTP is not configured", { to, subject });
    return;
  }

  await sendEmail({
    to,
    subject,
    text,
    html,
  });
});

registerJobHandler("sync_student_alerts", async (payload) => {
  const { syncStudentAlerts } = await import("./advising");
  await syncStudentAlerts(payload.studentId as string);
});
