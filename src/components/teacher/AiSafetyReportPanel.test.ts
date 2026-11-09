import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("AiSafetyReportPanel downloadable report", () => {
  const source = readFileSync(new URL("./AiSafetyReportPanel.tsx", import.meta.url), "utf8");

  it("keeps every font size in the report stylesheet at 13px or more", () => {
    const style = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const sizes = [...style.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length > 0);
    for (const size of sizes) assert.ok(size >= 13, `${size}px is under the 13px floor`);
  });

  it("sets the hash line at 13px", () => {
    assert.match(source, /\.hash \{.*font-size: 13px/);
  });
});
