import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { LogoPlate } from "./LogoPlate";

describe("LogoPlate", () => {
  it("always shows the white plate on a navy ground", () => {
    const html = renderToString(<LogoPlate onDark><img alt="SPOKES" src="/spokes-logo.png" /></LogoPlate>);
    assert.match(html, /class="[^"]*\bbg-white\b/);
    assert.doesNotMatch(html, /dark:bg-white/);
  });

  it("shows the plate only in the dark theme on a light ground", () => {
    const html = renderToString(<LogoPlate><img alt="SPOKES" src="/spokes-logo.png" /></LogoPlate>);
    assert.match(html, /dark:bg-white/);
  });
});
