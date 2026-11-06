import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

type TestSession = { id: string; studentId: string; displayName: string; role: string };
let session: TestSession | null;
let unplaced = false;
const dataReads: string[] = [];

let TeacherDashboard: typeof import("./page").default;

before(async () => {
  mock.module("@/lib/auth", { exports: { getSession: async () => session } });
  mock.module("@/lib/org-placement", { exports: { isUnplacedInstructor: async () => unplaced } });
  mock.module("@/lib/teacher/dashboard", {
    exports: {
      getTeacherHomeData: async () => {
        dataReads.push("home");
        throw new Error("student data was read");
      },
    },
  });
  mock.module("@/lib/teacher/today", {
    exports: {
      getTodayRoster: async () => {
        dataReads.push("roster");
        throw new Error("student data was read");
      },
    },
  });
  ({ default: TeacherDashboard } = await import("./page"));
});

beforeEach(() => {
  session = { id: "t1", studentId: "t", displayName: "Tess", role: "teacher" };
  unplaced = false;
  dataReads.length = 0;
});

describe("teacher home for an unplaced instructor", () => {
  it("shows the invite message and reads no student data", async () => {
    unplaced = true;
    const element = await TeacherDashboard({ searchParams: Promise.resolve({}) });
    const html = renderToString(element as React.ReactElement);

    assert.ok(html.includes("Ask your regional coordinator to invite you to your region."));
    assert.deepEqual(dataReads, []);
  });

  it("does not run the placement check for an admin", async () => {
    session = { id: "a1", studentId: "a", displayName: "A", role: "admin" };
    unplaced = true;
    await assert.rejects(() => TeacherDashboard({ searchParams: Promise.resolve({}) }), /student data was read/);
  });

  it("loads the dashboard for a placed instructor", async () => {
    await assert.rejects(() => TeacherDashboard({ searchParams: Promise.resolve({}) }), /student data was read/);
    assert.ok(dataReads.length > 0);
  });
});
