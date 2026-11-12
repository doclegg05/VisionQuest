import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";
import { InterventionQueueHeader, type InterventionQueueHeaderProps } from "./InterventionQueueHeader";

const noop = () => {};

function alert(id: string, severity: string): QueueAlert {
  return {
    id,
    type: "goal_review_pending",
    severity,
    title: "Goal review",
    summary: "New evidence on a goal.",
    sourceType: null,
    sourceId: null,
    detectedAt: "2026-10-03T12:00:00.000Z",
  };
}

const QUEUE = [
  { name: "Sam Rivera", openAlerts: [alert("c1", "critical"), alert("m1", "medium")] },
  { name: "Ana Lopez", openAlerts: [alert("h1", "high")] },
  { name: "Jo Park", openAlerts: [alert("l1", "low")] },
];

function render(overrides: Partial<InterventionQueueHeaderProps> = {}): string {
  return renderToString(
    <InterventionQueueHeader
      queue={QUEUE}
      listShown
      isDone={() => false}
      refreshOffered={false}
      onRefresh={noop}
      onAskSage={noop}
      {...overrides}
    >
      <h2>Intervention Queue</h2>
    </InterventionQueueHeader>,
  );
}

/** The rendered text, with React's comment markers between text parts removed. */
function text(html: string): string {
  return html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ");
}

function buttonTag(html: string, label: string): string {
  const match = html.match(new RegExp(`<button[^>]*>${label}</button>`));
  assert.ok(match, `no ${label} button`);
  return match[0];
}

describe("InterventionQueueHeader counts", () => {
  it("puts the counts right under the title the panel hands in", () => {
    const html = render();
    assert.ok(html.indexOf("<h2>Intervention Queue</h2>") > 0);
    assert.ok(html.indexOf("<h2>Intervention Queue</h2>") < html.indexOf("need follow-up"));
  });

  it("counts the students and the urgent ones", () => {
    assert.match(text(render()), /3 students need follow-up · 2 urgent/);
  });

  it("does not count an urgent alert whose line is shown as done", () => {
    assert.match(text(render({ isDone: (id) => id === "h1" })), /3 students need follow-up · 1 urgent/);
  });

  it("drops the urgent count when every urgent line is done", () => {
    const shown = text(render({ isDone: (id) => id === "h1" || id === "c1" }));
    assert.match(shown, /3 students need follow-up/);
    assert.doesNotMatch(shown, /urgent/);
  });

  it("hides the counts and Ask Sage while no list is showing", () => {
    const html = render({ listShown: false });
    assert.doesNotMatch(text(html), /need follow-up/);
    assert.doesNotMatch(html, />Ask Sage to prioritize<\/button>/);
  });
});

describe("InterventionQueueHeader Refresh list", () => {
  it("is not there until a done line is showing", () => {
    assert.doesNotMatch(render(), />Refresh list<\/button>/);
  });

  it("shows while a done line is showing, at least 44px tall", () => {
    const refresh = buttonTag(render({ refreshOffered: true }), "Refresh list");
    assert.match(refresh, /\bmin-h-11\b/);
    assert.match(refresh, /type="button"/);
  });

  it("is an outline pill like its neighbours, quieter than Ask Sage", () => {
    const html = render({ refreshOffered: true });
    const refresh = buttonTag(html, "Refresh list");
    const askSage = buttonTag(html, "Ask Sage to prioritize");
    for (const shared of ["inline-flex", "min-h-11", "items-center", "rounded-full", "px-4", "text-xs", "font-semibold"]) {
      assert.ok(refresh.includes(shared) && askSage.includes(shared), shared);
    }
    assert.match(refresh, /border-\[var\(--border\)\]/);
    assert.doesNotMatch(refresh, /bg-\[var\(--accent-strong\)\]/);
  });

  it("comes after Ask Sage, so Ask Sage does not move on a phone when it appears", () => {
    const html = render({ refreshOffered: true });
    assert.ok(html.indexOf(">Ask Sage to prioritize</button>") < html.indexOf(">Refresh list</button>"));
  });

  it("still shows with no list on screen, so a done line can always be cleared", () => {
    assert.match(render({ listShown: false, refreshOffered: true }), />Refresh list<\/button>/);
  });

  it("uses no raw palette colors and no dash characters", () => {
    const html = render({ refreshOffered: true });
    assert.doesNotMatch(html, /\b(?:bg|text|border)-(?:red|green|blue|gray|slate|amber|emerald|rose)-\d/);
    assert.doesNotMatch(text(html), /[‐-―−]| - /);
  });
});
