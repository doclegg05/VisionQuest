// =============================================================================
// VQ-R-024 — the client Sentry init must live where Turbopack loads it.
//
// Next 15+/Turbopack loads client instrumentation ONLY from
// src/instrumentation-client.ts; the old root sentry.client.config.ts was
// never bundled, so browser errors silently vanished. These static checks pin
// the convention files and their required exports so a future rename can't
// silently kill client error tracking again.
// =============================================================================
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(__dirname, "..");

describe("Sentry instrumentation wiring (VQ-R-024)", () => {
  it("client init lives at src/instrumentation-client.ts with the router hook", () => {
    const file = path.join(ROOT, "src", "instrumentation-client.ts");
    assert.ok(existsSync(file), "src/instrumentation-client.ts must exist");
    const source = readFileSync(file, "utf8");
    assert.match(source, /Sentry\.init\(/);
    assert.match(source, /NEXT_PUBLIC_SENTRY_DSN/);
    assert.match(source, /beforeSend: scrubPii/);
    assert.match(source, /export const onRouterTransitionStart = Sentry\.captureRouterTransitionStart/);
  });

  it("the dead root client config stays deleted", () => {
    assert.equal(existsSync(path.join(ROOT, "sentry.client.config.ts")), false);
  });

  it("instrumentation.ts exports onRequestError for RSC request errors", () => {
    const source = readFileSync(path.join(ROOT, "src", "instrumentation.ts"), "utf8");
    assert.match(source, /export const onRequestError = Sentry\.captureRequestError/);
  });
});
