import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useContext } from "react";
import { renderToString } from "react-dom/server";
import { MotionConfigContext } from "framer-motion";

import { MotionProvider } from "./MotionProvider";

/**
 * Framer Motion animations run in JavaScript, so the prefers-reduced-motion
 * block in globals.css cannot reach them. Without a MotionConfig the
 * dashboard's spring slide-up played even with Reduce Motion on
 * (HIG review A-5). reducedMotion="user" makes every framer animation follow
 * the system setting.
 */

function ReducedMotionProbe() {
  return <span>{useContext(MotionConfigContext).reducedMotion}</span>;
}

describe("MotionProvider", () => {
  it("tells framer-motion to follow the system Reduce Motion setting", () => {
    const html = renderToString(
      <MotionProvider>
        <ReducedMotionProbe />
      </MotionProvider>,
    );
    assert.match(html, /<span>user<\/span>/);
  });

  it("wraps every page from the root layout", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    assert.match(layout, /<MotionProvider>\s*\{children\}\s*<\/MotionProvider>/);
  });
});
