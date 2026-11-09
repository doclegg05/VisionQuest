import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/components/progression/MoodSparkline.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

// The sparkline sits in the teacher Overview tab card; 280px is a generous
// narrow case for that container at 375px viewport width.
const NARROWEST_CONTAINER_PX = 280;

it("any SVG text draws at least 13px at the narrowest container", () => {
  const viewBoxWidth = Number(source.match(/const svgWidth = (\d+)/)?.[1]);
  assert.ok(viewBoxWidth > 0, "svgWidth found");
  for (const m of source.matchAll(/fontSize=\{(\d+)\}/g)) {
    const rendered = Number(m[1]) * (NARROWEST_CONTAINER_PX / viewBoxWidth);
    assert.ok(rendered >= 13, `fontSize ${m[1]} in a ${viewBoxWidth}-wide viewBox draws ${rendered.toFixed(1)}px`);
  }
});

it("date labels are HTML text on the text-xs scale, which is at least 13px", () => {
  assert.match(source, /className="[^"]*text-xs[^"]*"[^>]*>\s*\{firstLabel\}/);
  assert.match(source, /className="[^"]*text-xs[^"]*"[^>]*>\s*\{lastLabel\}/);
  assert.doesNotMatch(source, /<text[\s\S]*?\{firstLabel\}/);
  const xs = css.match(/--text-xs:\s*([\d.]+)rem/);
  assert.ok(xs && Number(xs[1]) * 16 >= 13, "--text-xs is at least 13px");
});
