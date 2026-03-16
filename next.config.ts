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
          // CSP is now set dynamically in middleware.ts with per-request nonces
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
