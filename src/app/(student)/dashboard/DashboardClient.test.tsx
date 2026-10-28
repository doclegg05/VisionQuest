import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import type { DashboardSupport } from "@/lib/dashboard/support";

// Node does not process CSS modules; the browser harness verifies their real styles.
mock.module("@/components/dashboard/dashboard.module.css", { defaultExport: { workspace: "workspace" } });
mock.module("next/navigation", { namedExports: { useRouter: () => ({ refresh: () => {} }) } });
mock.module("@/components/progression/PathToEmployment", {
  namedExports: { PathToEmployment: () => <a data-testid="current-target-cta" href="/career">Next step</a> },
});

const support: DashboardSupport = {
  nextStep: {
    currentStepKey: "followUp",
    title: "Keep your applications moving",
    description: "",
    whyItMatters: "",
    actionLabel: "View Career Hub",
    actionLink: "/career",
    steps: [],
  },
  alertCount: 0,
  appointment: null,
  orientationItems: [],
  fetchedAt: "2026-10-28T00:00:00.000Z",
};

let DashboardClient: typeof import("./DashboardClient").default;
before(async () => { DashboardClient = (await import("./DashboardClient")).default; });

describe("DashboardClient layout", () => {
  // The 2026-08-20 mobile review: at 375px a student must see their next step
  // without scrolling, so nothing the page adds may sit above it.
  it("renders the next-step card before the page intro", (t) => {
    // React Query schedules a 5-minute cache timer on the server; fake it so the run can exit.
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const html = renderToString(
      <DashboardClient sessionId="s1" initialSupport={support} intro={<h1>Your dashboard</h1>} />,
    );
    const cta = html.indexOf('data-testid="current-target-cta"');
    const intro = html.indexOf("<h1>Your dashboard</h1>");
    assert.ok(cta >= 0, "next-step card not rendered");
    assert.ok(intro >= 0, "intro not rendered");
    assert.ok(cta < intro, "the next-step card must come before the intro");
  });
});
