import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";

// H1 (2026-11-10): with no src/app/global-error.tsx, a failure in the root
// layout itself showed Next's bare default page and reported nothing. The
// root layout is what failed, so this page brings its own <html> and <body>.

const SOURCE = readFileSync(fileURLToPath(new URL("./global-error.tsx", import.meta.url)), "utf8");

async function renderPage(): Promise<string> {
  const { default: GlobalError } = await import("./global-error");
  return renderToString(<GlobalError error={new Error("layout failed")} reset={() => {}} />);
}

describe("global-error page", () => {
  it("renders its own html and body", async () => {
    const html = await renderPage();
    assert.match(html, /^<html lang="en"[^>]*>(<head><\/head>)?<body/);
    assert.match(html, /<\/body><\/html>$/);
  });

  it("uses the same plain words as src/app/error.tsx", async () => {
    const html = await renderPage();
    assert.match(html, /<h1[^>]*>Something went wrong<\/h1>/);
    assert.match(html, /An unexpected error occurred\. Please try again\./);
    assert.match(html, /<button[^>]*type="button"[^>]*>Try again<\/button>/);
  });

  it("is a client component that reports the error", () => {
    assert.match(SOURCE, /^"use client";/);
    assert.match(SOURCE, /captureException\(error\)/);
  });

  it("loads the SDK only when a DSN is set, so the page adds nothing without one", () => {
    assert.match(SOURCE, /if \(!process\.env\.NEXT_PUBLIC_SENTRY_DSN\) return;/);
    assert.doesNotMatch(SOURCE, /^import .* from "@sentry\/nextjs";$/m);
  });
});
