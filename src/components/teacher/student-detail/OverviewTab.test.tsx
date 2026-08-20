import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";
import OverviewTab, {
  DiscoveryOverridePanel,
  NO_CLUSTER_VALUE,
  buildDiscoveryOverrideBody,
  discoveryClusterOptions,
  needsClusterBackfill,
} from "./OverviewTab";
import type { StudentData } from "./types";

const noop = () => {};

function makeStudentData(careerDiscovery: StudentData["careerDiscovery"]): StudentData {
  const category = { score: 0, max: 10, label: "0/10" };
  return {
    student: {
      id: "stu-1",
      studentId: "SPK-001",
      displayName: "Student One",
      email: null,
      createdAt: "2026-01-05T00:00:00.000Z",
      isActive: true,
      programType: "spokes",
    },
    progression: {
      xp: 0,
      level: 1,
      streaks: { daily: { current: 0, longest: 0 } },
      achievements: [],
    },
    readinessScore: 0,
    readinessBreakdown: {
      orientation: category,
      goalPlanning: category,
      bhagAchieved: category,
      certifications: category,
      portfolio: category,
      consistency: category,
    },
    goals: [],
    goalPlans: [],
    goalEvidence: [],
    reviewQueue: [],
    formSubmissions: [],
    orientation: { items: [], progress: [] },
    certification: { templates: [], cert: null },
    publicCredentialPage: null,
    applications: [],
    eventRegistrations: [],
    portfolio: [],
    hasResume: false,
    files: [],
    appointments: [],
    tasks: [],
    notes: [],
    alerts: [],
    conversations: [],
    careerDiscovery,
  };
}

function renderOverviewTab(careerDiscovery: StudentData["careerDiscovery"]): string {
  return renderToString(
    <OverviewTab
      data={makeStudentData(careerDiscovery)}
      moodEntries={[]}
      dateFormatter={new Intl.DateTimeFormat("en-US")}
      showResetPw={false}
      onToggleResetPw={noop}
      newPassword=""
      onNewPasswordChange={noop}
      resetStatus="idle"
      onResetPassword={noop}
      confirmDeactivate={false}
      onSetConfirmDeactivate={noop}
      deactivating={false}
      onToggleStudentStatus={noop}
      archiving={false}
      onArchive={noop}
      archiveResult={null}
      archiveError={null}
      hideAdminControls
    />,
  );
}

/** renderToString escapes text nodes, so match labels the way they render. */
function htmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;");
}

/**
 * True when the Confirm button carries the disabled ATTRIBUTE (`disabled=""`).
 * A bare /disabled/ match would false-positive on the Tailwind
 * `disabled:opacity-50` class present on every render.
 */
function confirmIsDisabled(html: string): boolean {
  const confirmTag = html.match(/<button[^>]*>Confirm<\/button>/)?.[0];
  assert.ok(confirmTag, "Confirm button not rendered");
  return /\sdisabled=""/.test(confirmTag);
}

function makeDiscovery(
  status: string,
  topClusters: string[],
): StudentData["careerDiscovery"] {
  return {
    status,
    topClusters,
    sageSummary: null,
    interests: [],
    strengths: [],
    subjects: [],
    problems: [],
    values: [],
    circumstances: [],
    completedAt: null,
  };
}

describe("buildDiscoveryOverrideBody", () => {
  it("omits clusterId entirely when no cluster is picked", () => {
    const body = buildDiscoveryOverrideBody(NO_CLUSTER_VALUE);
    assert.deepEqual(body, { status: "complete" });
    assert.equal("clusterId" in body, false);
  });

  it("includes the picked cluster", () => {
    assert.deepEqual(buildDiscoveryOverrideBody("tech-digital"), {
      status: "complete",
      clusterId: "tech-digital",
    });
  });
});

describe("discoveryClusterOptions", () => {
  it("offers every SPOKES career cluster, in catalog order", () => {
    assert.deepEqual(
      discoveryClusterOptions().map((option) => option.id),
      CAREER_CLUSTERS.map((cluster) => cluster.id),
    );
  });

  it("uses the catalog label for each option", () => {
    for (const option of discoveryClusterOptions()) {
      const cluster = CAREER_CLUSTERS.find((c) => c.id === option.id);
      assert.equal(option.label, cluster?.label);
    }
  });
});

describe("needsClusterBackfill", () => {
  it("flags a complete discovery with no recorded clusters", () => {
    assert.equal(needsClusterBackfill("complete", []), true);
  });

  it("does not flag a complete discovery that already has a cluster", () => {
    assert.equal(needsClusterBackfill("complete", ["office-admin"]), false);
  });

  it("does not flag an in-progress discovery (the complete-override flow owns it)", () => {
    assert.equal(needsClusterBackfill("in_progress", []), false);
  });

  it("does not flag a discovery that never started", () => {
    assert.equal(needsClusterBackfill("not_started", []), false);
  });
});

describe("DiscoveryOverridePanel", () => {
  it("renders one option per SPOKES cluster plus the placeholder", () => {
    const html = renderToString(
      <DiscoveryOverridePanel
        isClusterBackfill={false}
        clusterId={NO_CLUSTER_VALUE}
        onClusterIdChange={noop}
        saving={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    const optionCount = (html.match(/<option/g) ?? []).length;
    assert.equal(optionCount, CAREER_CLUSTERS.length + 1);
    for (const cluster of CAREER_CLUSTERS) {
      assert.ok(
        html.includes(htmlEscape(cluster.label)),
        `missing option for ${cluster.id}`,
      );
    }
  });

  it("keeps the cluster optional when completing discovery", () => {
    const html = renderToString(
      <DiscoveryOverridePanel
        isClusterBackfill={false}
        clusterId={NO_CLUSTER_VALUE}
        onClusterIdChange={noop}
        saving={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    assert.ok(html.includes("(optional)"));
    assert.ok(html.includes("No cluster yet"));
    assert.equal(confirmIsDisabled(html), false);
  });

  it("requires a cluster pick in backfill mode", () => {
    const html = renderToString(
      <DiscoveryOverridePanel
        isClusterBackfill
        clusterId={NO_CLUSTER_VALUE}
        onClusterIdChange={noop}
        saving={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    assert.equal(confirmIsDisabled(html), true);
    assert.ok(html.includes("Choose a cluster"));
  });

  it("enables Confirm once a backfill cluster is picked", () => {
    const html = renderToString(
      <DiscoveryOverridePanel
        isClusterBackfill
        clusterId="tech-digital"
        onClusterIdChange={noop}
        saving={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    assert.equal(confirmIsDisabled(html), false);
  });
});

describe("OverviewTab discovery controls", () => {
  it("offers the cluster backfill on a complete discovery with no clusters", () => {
    const html = renderOverviewTab(makeDiscovery("complete", []));
    assert.ok(html.includes("Record career cluster"));
    assert.equal(html.includes("Mark discovery complete"), false);
  });

  it("shows no override control once a complete discovery has a cluster", () => {
    const html = renderOverviewTab(makeDiscovery("complete", ["office-admin"]));
    assert.equal(html.includes("Record career cluster"), false);
    assert.equal(html.includes("Mark discovery complete"), false);
  });

  it("offers the completion override while discovery is in progress", () => {
    const html = renderOverviewTab(makeDiscovery("in_progress", []));
    assert.ok(html.includes("Mark discovery complete"));
    assert.equal(html.includes("Record career cluster"), false);
  });
});
