import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { CareerDnaHighlights } from "./CareerDnaHighlights";
import type { RiasecDimensionView } from "@/lib/career-profile";

const topInterests: RiasecDimensionView[] = [
  {
    key: "social",
    label: "Social",
    nickname: "Helper",
    plainLanguage: "You like helping and teaching people.",
    score: 0.8,
    percent: 80,
  },
];

describe("CareerDnaHighlights", () => {
  it("renders nothing when there are no top interests", () => {
    const html = renderToString(<CareerDnaHighlights topInterests={[]} />);
    assert.equal(html, "");
  });

  it("credits a real assessment when profileSource is assessed", () => {
    const html = renderToString(
      <CareerDnaHighlights topInterests={topInterests} profileSource="student_reported_cos" />,
    );
    assert.ok(html.includes("from your CareerOneStop results"));
    assert.ok(!html.includes("Sage thinks"));
  });

  it("credits a real assessment for the cos_api source too", () => {
    const html = renderToString(
      <CareerDnaHighlights topInterests={topInterests} profileSource="cos_api" />,
    );
    assert.ok(html.includes("from your CareerOneStop results"));
  });

  it("names Sage's guess (not a real assessment) when the source is sage_inferred", () => {
    const html = renderToString(
      <CareerDnaHighlights topInterests={topInterests} profileSource="sage_inferred" />,
    );
    assert.ok(html.includes("Sage thinks you enjoy most"));
    assert.ok(!html.includes("CareerOneStop results"));
  });

  it("falls back to the conservative Sage's-guess framing when profileSource is not passed", () => {
    const html = renderToString(<CareerDnaHighlights topInterests={topInterests} />);
    assert.ok(html.includes("Sage thinks you enjoy most"));
  });
});
