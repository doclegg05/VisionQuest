import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";

// H1 privacy follow-up, item 13 (2026-11-10). src/app/error.tsx imported the
// SDK statically. It is in every page's client graph, so that one import put
// the whole SDK in the scripts every page loads first and undid the lazy
// loading in src/instrumentation-client.ts.

const SOURCE = readFileSync(fileURLToPath(new URL("./error.tsx", import.meta.url)), "utf8");

describe("root error page", () => {
  it("does not import the SDK", () => {
    assert.doesNotMatch(SOURCE, /@sentry\/nextjs/);
  });

  it("reports through the lazy path in src/instrumentation-client.ts", () => {
    assert.match(SOURCE, /^import \{ reportClientError \} from "@\/instrumentation-client";$/m);
    assert.match(SOURCE, /reportClientError\(error\)/);
  });

  it("still renders its plain words and a way to try again", async () => {
    const { default: ErrorPage } = await import("./error");
    const html = renderToString(<ErrorPage error={new Error("render failed")} reset={() => {}} />);
    assert.match(html, /<h1[^>]*>Something went wrong<\/h1>/);
    assert.match(html, /<button[^>]*>Try again<\/button>/);
  });
});
