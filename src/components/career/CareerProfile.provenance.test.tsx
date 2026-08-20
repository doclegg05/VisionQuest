import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { CareerProfile } from "./CareerProfile";
import type { CareerDiscoveryData } from "@/lib/career-discovery";

function buildDiscovery(overrides: Partial<CareerDiscoveryData> = {}): CareerDiscoveryData {
  return {
    id: "cd-1",
    status: "complete",
    hollandCode: "RSC",
    riasecScores: {
      realistic: 0.8,
      investigative: 0.2,
      artistic: 0,
      social: 0.6,
      enterprising: 0.1,
      conventional: 0.4,
    },
    nationalClusters: null,
    transferableSkills: null,
    workValues: null,
    sageSummary: null,
    completedAt: new Date("2026-08-01T00:00:00Z"),
    profileSource: "sage_inferred",
    assessedAt: null,
    ...overrides,
  };
}

describe("CareerProfile provenance labels", () => {
  it("labels an inferred profile as Sage's read, not a formal assessment", () => {
    const html = renderToString(<CareerProfile discovery={buildDiscovery()} />);
    assert.ok(html.includes("What Sage has learned from your conversations"));
    assert.ok(html.includes("not a formal assessment"));
    assert.ok(!html.includes("From your CareerOneStop results"));
  });

  it("labels a student-reported assessed profile with the save date", () => {
    const html = renderToString(
      <CareerProfile
        discovery={buildDiscovery({
          profileSource: "student_reported_cos",
          assessedAt: new Date("2026-03-03T12:00:00Z"),
        })}
      />,
    );
    assert.ok(html.includes("From your CareerOneStop results"));
    assert.ok(html.includes("March 3, 2026"));
    assert.ok(!html.includes("not a formal assessment"));
  });

  it("labels an API-sourced profile as assessed too", () => {
    const html = renderToString(
      <CareerProfile
        discovery={buildDiscovery({
          profileSource: "cos_api",
          assessedAt: new Date("2026-03-03T12:00:00Z"),
        })}
      />,
    );
    assert.ok(html.includes("From your CareerOneStop results"));
  });
});
