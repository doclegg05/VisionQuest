import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { OutcomesReportView, type ReportPayload } from "./OutcomesReport";

const SUMMARY: ReportPayload["summary"] = {
  totalStudents: 3,
  activeStudents7d: 1,
  studentsNeedingAttention: 2,
  openAlerts: 3,
  highSeverityAlerts: 2,
  overdueTasks: 0,
  openTasks: 0,
  upcomingAppointments7d: 0,
  activeOpportunities: 0,
  closingSoonOpportunities: 0,
  applicationsInFlight: 0,
  interviews: 0,
  offers: 0,
  upcomingEvents: 0,
  eventRegistrations: 0,
  completedCertifications: 0,
  publicCredentialsLive: 0,
  studentsWithoutCareerMomentum: 3,
};

const STUDENT: ReportPayload["attentionQueue"][number] = {
  id: "stu-1",
  studentId: "S-001",
  displayName: "Sam Rivera",
  openAlertCount: 2,
  highSeverityAlertCount: 1,
  topAlertTitle: "Wellbeing check-in needed",
  lastActivityAt: null,
  daysSinceActivity: null,
  nextAppointmentAt: null,
  openTaskCount: 0,
  overdueTaskCount: 0,
  applicationsInFlight: 0,
  eventRegistrationCount: 0,
  completedCertification: false,
  publicCredentialLive: false,
};

function render(overrides: Partial<ReportPayload> = {}): string {
  const data: ReportPayload = {
    summary: SUMMARY,
    funnel: [],
    attentionQueue: [STUDENT],
    recentApplications: [],
    upcomingEvents: [],
    ...overrides,
  };
  // React separates adjacent text nodes with empty comments; drop them so the
  // assertions read the text a teacher sees.
  return renderToString(<OutcomesReportView data={data} />).replace(/<!-- -->/g, "");
}

// The report's urgent counts include critical (crisis) alerts as well as high
// ones (src/lib/reporting.ts), so the labels say "urgent", not "high".
describe("OutcomesReportView urgent alert labels", () => {
  it("labels the summary's urgent total as urgent alerts", () => {
    const html = render();
    assert.match(html, />2 urgent alerts</);
    assert.doesNotMatch(html, /high-severity/);
  });

  it("uses the singular for one urgent alert", () => {
    const html = render({ summary: { ...SUMMARY, highSeverityAlerts: 1 } });
    assert.match(html, />1 urgent alert</);
  });

  it("labels a student's urgent badge as urgent", () => {
    const html = render();
    assert.match(html, />1 urgent</);
    assert.doesNotMatch(html, />\d+ high</);
  });
});
