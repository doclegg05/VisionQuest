import * as Sentry from "@sentry/nextjs";
import { scrubPii } from "./src/lib/sentry-scrub";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
    beforeSend: scrubPii,
  });
}
