import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

const STAFF_ID = "cl0staffaaaaaaaaaaaaaaaaa";
const STUDENT_ID = "cl0studentaaaaaaaaaaaaaaa";

// Which reader the current test makes fail; null = every region loads.
let failingReader: "activity" | "tasks" | null = null;
const viewsRecorded: unknown[] = [];

mock.module("@/lib/auth", {
  namedExports: { getSession: async () => ({ id: STAFF_ID, role: "teacher", displayName: "Staff" }) },
});
mock.module("@/lib/classroom", {
  namedExports: { assertStaffCanManageStudent: async () => ({ id: STUDENT_ID, displayName: "Test Student" }) },
});
mock.module("@/lib/audit", {
  namedExports: { recordStudentView: async (input: unknown) => { viewsRecorded.push(input); } },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } },
});
mock.module("@/lib/progression/student-next-step", {
  namedExports: {
    getStudentNextStep: async () => ({ title: "Finish orientation", description: "", whyItMatters: "" }),
  },
});
mock.module("@/lib/dashboard/readers", { namedExports: {
  readOverview: async () => ({ outcomes: [{ label: "Certifications", value: "1", detail: "" }] }),
  readActivity: async () => {
    if (failingReader === "activity") throw new Error("activity read failed");
    return { statuses: [{ status: "in_progress", count: 2 }] };
  },
} });
mock.module("@/lib/dashboard/tasks", { namedExports: {
  readTasks: async () => {
    if (failingReader === "tasks") throw new Error("task read failed");
    return { tasks: [{ id: "t1", title: "Update resume", status: "not_started", personal: false }], total: 1, pageSize: 10 };
  },
} });

let Preview: typeof import("./page").default;

before(async () => {
  Preview = (await import("./page")).default;
});

beforeEach(() => {
  failingReader = null;
});

// React separates adjacent text nodes with <!-- --> markers; drop them so assertions read like the page.
const render = async () =>
  renderToString(await Preview({ params: Promise.resolve({ id: STUDENT_ID }) })).replaceAll("<!-- -->", "");

describe("Staff dashboard preview", () => {
  it("renders every region and records the staff view", async () => {
    const html = await render();
    assert.match(html, /Finish orientation/);
    assert.match(html, /Update resume/);
    assert.match(html, /in progress: 2/);
    assert.match(html, /UTC/);
    assert.ok(viewsRecorded.length > 0);
  });

  it("keeps the other regions when task activity fails to load", async () => {
    failingReader = "activity";
    const html = await render();
    assert.match(html, /Task activity could not load/);
    assert.match(html, /Update resume/);
    assert.match(html, /Certifications/);
  });

  it("keeps the other regions when tasks fail to load", async () => {
    failingReader = "tasks";
    const html = await render();
    assert.match(html, /Tasks could not load/);
    assert.match(html, /in progress/);
  });
});
