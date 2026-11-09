import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import BrandLockup from "./BrandLockup";

/**
 * With `h-auto w-auto` an image renders at its served file size unless something
 * bounds it, which crowds the non-wrapping mobile top bar. Each size variant
 * must carry an explicit pixel bound on both logos (spokes at full size, WVAE at 90%).
 */
const BOUNDS = {
  sm: { spokes: ["max-w-[54px]", "max-h-[36px]"], wvae: ["max-w-[49px]", "max-h-[32px]"] },
  md: { spokes: ["max-w-[76px]", "max-h-[50px]"], wvae: ["max-w-[68px]", "max-h-[45px]"] },
  lg: { spokes: ["max-w-[108px]", "max-h-[72px]"], wvae: ["max-w-[97px]", "max-h-[65px]"] },
} as const;

function imgTag(html: string, alt: string): string {
  const tag = html.match(new RegExp(`<img[^>]*alt="${alt}"[^>]*>`));
  assert.ok(tag, `${alt} image not rendered`);
  return tag[0];
}

describe("BrandLockup logo size bounds", () => {
  for (const size of ["sm", "md", "lg"] as const) {
    it(`bounds both logos at size ${size}`, () => {
      const html = renderToString(<BrandLockup size={size} />);
      for (const cls of BOUNDS[size].spokes) assert.ok(imgTag(html, "SPOKES logo").includes(cls), `SPOKES logo lacks ${cls}`);
      for (const cls of BOUNDS[size].wvae) assert.ok(imgTag(html, "WVAE logo").includes(cls), `WVAE logo lacks ${cls}`);
    });
  }
});
