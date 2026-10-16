import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import type { TodayRosterEntry } from "@/lib/teacher/today";
import TodayRoster from "./TodayRoster";

function entry(overrides: Partial<TodayRosterEntry> = {}): TodayRosterEntry {
  return {
    studentId: "stu-1",
    id: "S-001",
    name: "Sam Rivera",
    programType: "spokes",
    presence: "present",
    lastActiveAt: null,
    activeTask: null,
    lastConversationAt: null,
    openAlertCount: 0,
    highSeverityAlertCount: 0,
    ...overrides,
  };
}

// The badge counts critical and high alerts together (src/lib/teacher/today.ts),
// so "high-severity" would undercount what it shows. It says "urgent".
describe("TodayRoster alert badge", () => {
  it("labels one critical-or-high alert as one urgent alert", () => {
    const html = renderToString(
      <TodayRoster roster={[entry({ openAlertCount: 1, highSeverityAlertCount: 1 })]} />,
    );
    assert.match(html, /title="1 urgent alert"/);
    assert.doesNotMatch(html, /high-severity/);
  });

  it("labels several as urgent alerts", () => {
    const html = renderToString(
      <TodayRoster roster={[entry({ openAlertCount: 3, highSeverityAlertCount: 2 })]} />,
    );
    assert.match(html, /title="2 urgent alerts"/);
  });

  it("shows no badge when nothing is urgent", () => {
    const html = renderToString(<TodayRoster roster={[entry({ openAlertCount: 2 })]} />);
    assert.doesNotMatch(html, /urgent alert/);
  });
});
