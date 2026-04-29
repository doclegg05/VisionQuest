import path from "path";
import { fileURLToPath } from "url";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";

const nextConfig: NextConfig = {
  output: isWindows ? undefined : "standalone",
  // Pin the trace root to this directory so Next/Turbopack don't walk
  // upward and pull random parent-directory files into the NFT.
  outputFileTracingRoot: repoRoot,
  // Exclude project artifacts that the standalone server doesn't need
  // at runtime. Without this, every API route's NFT pulls in ~1,800
  // markdown/PDF/script files (verified via .nft.json inspection on
  // 2026-04-29: archive route had AGENTS.md, docs/**, PDFs, .py files).
  outputFileTracingExcludes: {
    "*": [
      "**/*.md",
      "docs/**",
      "docs-upload/**",
      "uploads/**",
      "artifacts/**",
      "playwright-report/**",
      "test-results/**",
      "e2e/**",
      "scripts/**",
      "**/*.py",
      "**/*.pdf",
      "broken-documents-backup-*.json",
      "next.config.ts",
      "next.config.js",
    ],
  },
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
          // Content-Security-Policy is set per-request by src/middleware.ts
          // with a nonce. No static CSP here to avoid dual-header conflicts.
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
