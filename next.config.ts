import path from "path";
import { fileURLToPath } from "url";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";

const nextConfig: NextConfig = {
  output: isWindows ? undefined : "standalone",
  turbopack: {
    root: repoRoot,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-XSS-Protection", value: "0" },
          // Static CSP — nonce-based CSP requires middleware which is blocked
          // by Turbopack + standalone mode (no middleware.js generated).
          // CSRF protection remains via src/proxy.ts Origin header validation.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://images.credly.com https://www.credly.com",
              "connect-src 'self' https://generativelanguage.googleapis.com https://*.ingest.sentry.io",
              "frame-src 'none'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Only upload source maps if SENTRY_AUTH_TOKEN is set
  silent: !process.env.SENTRY_AUTH_TOKEN,
});
