import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { JobCard } from "./JobCard";
import { WORKFORCE_WV_COMPANY_LABEL } from "@/lib/job-board/wv-employer";

/**
 * HIG review g10 round 1: JobCard's pills used raw palette pairs (-300 text
 * on a light tint, about 1.4:1; -700 text on the dark surface, about 2.2:1)
 * and the light-only --accent as text (about 2.7:1 on white). Every colored
 * pill and state now uses a theme-aware token pair.
 */
const RAW_PALETTE = /\b(?:text|bg)-(?:green|blue|purple|pink|orange|teal|amber|emerald|sky)-\d{2,3}\b/;

function renderCard(overrides: Partial<Parameters<typeof JobCard>[0]>) {
  return renderToString(
    <JobCard
      id="job-1"
      title="Bookkeeper"
      company={WORKFORCE_WV_COMPANY_LABEL}
      location="Charleston, WV"
      workMode="onsite"
      salary="$18/hr"
      matchScore={80}
      matchLabel="Strong match"
      clusters={["finance-bookkeeping"]}
      savedStatus="saved"
      url="https://example.org/job"
      source="careeronestop"
      onSave={() => {}}
      {...overrides}
    />,
  );
}

const VARIANTS: Array<Partial<Parameters<typeof JobCard>[0]>> = [
  {},
  { workMode: "remote", matchLabel: "Good match", clusters: ["tech-digital"] },
  { workMode: "hybrid", clusters: ["creative-design"], savedStatus: null },
];

describe("JobCard colors", () => {
  for (const overrides of VARIANTS) {
    const html = renderCard(overrides);

    it(`uses no raw palette classes (${JSON.stringify(overrides)})`, () => {
      assert.doesNotMatch(html, RAW_PALETTE);
    });

    it(`uses no light-only --accent or --primary for text or fills (${JSON.stringify(overrides)})`, () => {
      assert.doesNotMatch(html, /(?:text|bg)-\[var\(--(?:accent|primary)\)\]/);
      assert.doesNotMatch(html, /\btext-white\b/);
    });
  }

  it("styles the Update action as the primary button", () => {
    assert.match(renderCard({}), /class="primary-button[^"]*"[^>]*>Update</);
  });
});
