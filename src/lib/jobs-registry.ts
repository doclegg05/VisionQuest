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
    // Fail loud instead of marking the job complete. A silent skip used to hide
    // a real delivery gap — wellbeing/crisis alerts and nudges depend on email,
    // and "completed with nothing sent" is indistinguishable from success in
    // monitoring. Throwing lets the job queue record a visible failure (and
    // surfaces the misconfiguration) instead of a phantom success.
    logger.error("Email job failed: SMTP is not configured", {
      to,
      subject,
      alert: "email_delivery_unconfigured",
    });
    throw new Error("Email delivery is not configured (SMTP_* env vars missing).");
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

registerJobHandler("snapshot_grant_kpis", async (payload) => {
  const { takeGrantKpiSnapshot } = await import("./grant-kpi-history");
  await takeGrantKpiSnapshot(payload.classId as string | undefined);
});

registerJobHandler("scrape_jobs", async (payload) => {
  const { runScrapeForConfig } = await import("./job-board/scrape-engine");
  const sourceAllowlist = Array.isArray(payload.sources)
    ? payload.sources.filter((source): source is string => typeof source === "string")
    : undefined;
  await runScrapeForConfig(payload.configId as string, {
    scrapeRunId: typeof payload.scrapeRunId === "string" ? payload.scrapeRunId : undefined,
    trigger: "manual",
    backgroundJobId: typeof payload.backgroundJobId === "string" ? payload.backgroundJobId : undefined,
    sourceAllowlist,
  });
});

registerJobHandler("wager_diagnosis", async (payload) => {
  const { diagnoseWager } = await import("./sage/wager-diagnosis");
  await diagnoseWager(payload.wagerId as string);
});

registerJobHandler("sage_briefing", async (payload) => {
  const { runDailyBriefing } = await import("./sage/briefing");
  await runDailyBriefing(payload.studentId as string);
});
