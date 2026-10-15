import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import type { TeacherDashboardPageData } from "@/lib/teacher/dashboard";
import ClassOverview from "./ClassOverview";

const DATA: TeacherDashboardPageData = {
  classes: [],
  currentClassId: null,
  students: [],
  upcomingAppointments: [
    {
      id: "appt-1",
      title: "Résumé check-in",
      startsAt: "2026-10-16T14:00:00.000Z",
      endsAt: "2026-10-16T14:30:00.000Z",
      locationType: "in_person",
      locationLabel: null,
      student: { id: "stu-1", studentId: "S-001", displayName: "Sam Rivera" },
    },
  ],
  total: 0,
  page: 1,
  limit: 50,
  totalPages: 1,
};

const html = renderToString(<ClassOverview initialData={DATA} />);

describe("ClassOverview", () => {
  it("does not render a second intervention queue", () => {
    assert.doesNotMatch(html, /Intervention Queue/);
  });

  it("shows upcoming appointments without a toggle", () => {
    assert.match(html, /Upcoming appointments/);
    assert.match(html, /Résumé check-in/);
    assert.match(html, /in person/);
  });

  it("leaves the need-attention count to the queue", () => {
    assert.doesNotMatch(html, /Need Attention/);
  });
});
