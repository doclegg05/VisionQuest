import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

// find_appointment_slots reads open slots through listBookableAdvisors. The
// stand-in records the options it is called with; the audience filter itself
// is covered in src/lib/advising.test.ts.
const mockListBookableAdvisors = mock.fn(async (_options?: unknown): Promise<unknown[]> => []);

mock.module("@/lib/advising", {
  exports: {
    listBookableAdvisors: mockListBookableAdvisors,
    syncStudentAlerts: async () => undefined,
  },
});

let getToolByName: typeof import("./tools").getToolByName;

before(async () => {
  ({ getToolByName } = await import("./tools"));
});

const CTX = {
  session: { id: "stu-1", role: "student" },
  conversationId: "conv-1",
} as never;

describe("present_form — link target", () => {
  it("links catalog forms to the PDF download endpoint, NOT the Forms Hub fill route", async () => {
    const tool = getToolByName("present_form");
    assert.ok(tool, "present_form tool exists");

    const result = await tool.execute({ query: "education and career plan" }, CTX);

    assert.equal(result.status, "success");
    assert.equal(result.action?.action, "open_form");
    // /forms/<catalog-slug> is the Forms Hub fill UI keyed by DB FormTemplate
    // ids — catalog slugs 404 there ("We couldn't load this form").
    assert.equal(
      result.action?.target,
      "/api/forms/download?formId=education-career-plan&mode=view",
    );
    assert.equal(result.action?.meta?.title, "Education and Career Plan");
    assert.equal(typeof result.action?.meta?.description, "string");
  });

  it("fuzzy match still resolves the right form", async () => {
    const tool = getToolByName("present_form");
    const result = await tool!.execute({ query: "career plan" }, CTX);
    assert.equal(result.status, "success");
    assert.match(String(result.summary), /Education and Career Plan/);
  });

  it("schema example uses the canonical student-profile id", () => {
    const tool = getToolByName("present_form");
    assert.ok(tool);
    const queryDesc = String(
      (tool.parameters.properties as { query?: { description?: string } }).query
        ?.description ?? "",
    );
    assert.match(queryDesc, /student-profile/);
    assert.ok(!queryDesc.includes("spokes-student-profile"));
  });

  it("resolves the spokes-student-profile alias to student-profile", async () => {
    const tool = getToolByName("present_form");
    const result = await tool!.execute({ query: "spokes-student-profile" }, CTX);
    assert.equal(result.status, "success");
    assert.equal(
      (result.data as { formId?: string } | undefined)?.formId,
      "student-profile",
    );
    assert.equal(
      result.action?.target,
      "/api/forms/download?formId=student-profile&mode=view",
    );
  });
});

describe("open_resource — career-discovery redirect loop fix", () => {
  it("no longer resolves the self-referential career-discovery resource", async () => {
    const tool = getToolByName("open_resource");
    assert.ok(tool, "open_resource tool should exist");
    const result = await tool.execute({ resourceId: "career-discovery" }, CTX);
    assert.equal(result.status, "error");
  });

  it("still resolves a real resource (goals)", async () => {
    const tool = getToolByName("open_resource");
    assert.ok(tool, "open_resource tool should exist");
    const result = await tool.execute({ resourceId: "goals" }, CTX);
    assert.equal(result.status, "success");
    assert.equal(result.action?.target, "/goals");
    assert.equal(result.action?.meta?.title, "Goals");
    assert.match(String(result.action?.meta?.description ?? ""), /active goals/i);
  });
});

describe("find_appointment_slots, by booking audience", () => {
  const DEFAULT_OPTIONS = { days: 14, maxSlotsPerAdvisor: 6, minimumLeadMinutes: 60 };

  function contextFor(session: Record<string, unknown>) {
    return { session, conversationId: "conv-1" } as never;
  }

  beforeEach(() => {
    mockListBookableAdvisors.mock.resetCalls();
  });

  it("looks up the demo instructor's slots for a demo student", async () => {
    const tool = getToolByName("find_appointment_slots");
    assert.ok(tool, "find_appointment_slots tool exists");

    const result = await tool.execute(
      {},
      contextFor({ id: "stu-demo", role: "student", demoAccount: "student" }),
    );

    assert.equal(result.status, "success");
    assert.deepEqual(mockListBookableAdvisors.mock.calls[0].arguments, [
      { ...DEFAULT_OPTIONS, audience: "demo" },
    ]);
  });

  it("looks up the demo instructor's slots for the demo instructor", async () => {
    const tool = getToolByName("find_appointment_slots");
    assert.ok(tool);

    await tool.execute({}, contextFor({ id: "tch-demo", role: "teacher", demoAccount: "instructor" }));

    assert.deepEqual(mockListBookableAdvisors.mock.calls[0].arguments, [
      { ...DEFAULT_OPTIONS, audience: "demo" },
    ]);
  });

  it("looks up real advisors' slots for a real student", async () => {
    const tool = getToolByName("find_appointment_slots");
    assert.ok(tool);

    await tool.execute({ withinDays: 7 }, contextFor({ id: "stu-1", role: "student" }));

    assert.deepEqual(mockListBookableAdvisors.mock.calls[0].arguments, [
      { ...DEFAULT_OPTIONS, days: 7, audience: "standard" },
    ]);
  });
});
