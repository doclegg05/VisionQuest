/**
 * Job handler registry — registers all background job handlers.
 * Import this module once at app startup to ensure handlers are available.
 */
import { registerJobHandler } from "./jobs";
import { handlePostResponse } from "./chat/post-response";
import { logger } from "./logger";

// Chat post-response processing (goal extraction, XP, stage updates, title)
registerJobHandler("chat_post_response", async (payload) => {
  await handlePostResponse(payload as unknown as Parameters<typeof handlePostResponse>[0]);
});

// Placeholder for future job types
registerJobHandler("send_email", async (payload) => {
  logger.info("Email job received (not yet implemented)", payload);
});

registerJobHandler("sync_student_alerts", async (payload) => {
  const { syncStudentAlerts } = await import("./advising");
  await syncStudentAlerts(payload.studentId as string);
});
