import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Strip PII from Sentry events before transmission.
 * VisionQuest handles TANF/SNAP recipients — no student data should reach Sentry.
 */
export function scrubPii(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
  }

  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers["cookie"];
      delete event.request.headers["authorization"];
      delete event.request.headers["x-forwarded-for"];
    }
  }

  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (typeof breadcrumb.message === "string") {
        breadcrumb.message = breadcrumb.message.replace(
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
          "[EMAIL_REDACTED]",
        );
      }
    }
  }

  return event;
}
