import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { JobCard } from "./JobCard";
import {
  MACC_APPLY_HINT,
  WORKFORCE_WV_BADGE,
  WORKFORCE_WV_COMPANY_LABEL,
} from "@/lib/job-board/wv-employer";

function renderCard(overrides?: Partial<Parameters<typeof JobCard>[0]>) {
  return renderToString(
    <JobCard
      id="job-1"
      title="Production Associate"
      company={WORKFORCE_WV_COMPANY_LABEL}
      location="Charleston, WV"
      workMode="onsite"
      salary={null}
      matchScore={70}
      matchLabel={null}
      clusters={[]}
      savedStatus={null}
      url="https://de.jobsyn.org/abc123"
      source="careeronestop"
      {...(overrides ?? {})}
    />,
  );
}

describe("JobCard — WorkForce WV posting", () => {
  it("badges a WorkForce WV posting and explains the MACC sign-in beside the apply link", () => {
    const html = renderCard();
    assert.ok(html.includes(WORKFORCE_WV_BADGE));
    assert.ok(html.includes(MACC_APPLY_HINT));
  });

  it("keeps the hint in compact mode so the dashboard widget still warns about the sign-in", () => {
    const html = renderCard({ compact: true });
    assert.ok(html.includes(WORKFORCE_WV_BADGE));
    assert.ok(html.includes(MACC_APPLY_HINT));
  });

  it("shows neither on an ordinary NLx employer posting", () => {
    const html = renderCard({ company: "Cardinal Health" });
    assert.ok(!html.includes(WORKFORCE_WV_BADGE));
    assert.ok(!html.includes(MACC_APPLY_HINT));
  });

  it("shows neither when the label appears on a non-NLx source", () => {
    const html = renderCard({ source: "jsearch" });
    assert.ok(!html.includes(WORKFORCE_WV_BADGE));
    assert.ok(!html.includes(MACC_APPLY_HINT));
  });
});
