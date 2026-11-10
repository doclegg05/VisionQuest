/**
 * The student dashboard loader against the per-student readers it replaces on
 * the student's own page: for the same rows it must build the same overview,
 * next step and activity that `readOverview`, `getStudentNextStep` and
 * `readActivity` build (the teacher's view of the student still calls those).
 * Then: two students with different rows never see each other's values,
 * cached or not.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { createInitialState } from "@/lib/progression/engine";
import { createQueryCounter, type QueryFixtures } from "@/lib/query-counter.test-support";
import { DASHBOARD_FIXTURES, DASHBOARD_STUDENT_ID } from "@/lib/readiness/dashboard-fixtures.test-support";

const OTHER_ID = "stu-readiness-002";
const counter = createQueryCounter(DASHBOARD_FIXTURES);
mock.module("@/lib/db", { exports: counter.dbModule });

let loader: typeof import("./student-dashboard");
let readers: typeof import("./readers");
let nextStep: typeof import("@/lib/progression/student-next-step");
let cache: typeof import("@/lib/cache");

before(async () => {
  loader = await import("./student-dashboard");
  readers = await import("./readers");
  nextStep = await import("@/lib/progression/student-next-step");
  cache = await import("@/lib/cache");
});
beforeEach(() => {
  cache.invalidateAllChatContext();
  counter.useFixtures(DASHBOARD_FIXTURES);
});

const NOW = new Date("2026-11-10T15:00:00.000Z");
const student = (id: string) => ({ id, role: "student" });

function studentOf(args: unknown): string | undefined {
  const where = typeof args === "object" && args !== null ? Reflect.get(args, "where") : undefined;
  const id = typeof where === "object" && where !== null ? Reflect.get(where, "studentId") : undefined;
  return typeof id === "string" ? id : undefined;
}
/** Answers `mine` for DASHBOARD_STUDENT_ID and `theirs` for OTHER_ID. */
const perStudent = (mine: unknown, theirs: unknown) => (args: unknown) => (studentOf(args) === OTHER_ID ? theirs : mine);

describe("loadStudentDashboard", () => {
  it("builds what the per-student readers build from the same rows", async () => {
    const loaded = await loader.loadStudentDashboard(student(DASHBOARD_STUDENT_ID), NOW);
    const overview = await readers.readOverview(DASHBOARD_STUDENT_ID);
    const activity = await readers.readActivity(DASHBOARD_STUDENT_ID);
    const step = await nextStep.getStudentNextStep(DASHBOARD_STUDENT_ID);
    assert.deepEqual(loaded.overview.outcomes, overview.outcomes);
    assert.deepEqual({ ...loaded.activity, fetchedAt: "" }, { ...activity, fetchedAt: "" });
    assert.deepEqual(loaded.support.nextStep, step);
    assert.equal(loaded.support.alertCount, 1);
    assert.deepEqual(loaded.support.orientationItems, [{ id: "item-1", label: "Sign the attendance policy" }]);
  });

  it("refuses a staff session", async () => {
    await assert.rejects(loader.loadStudentDashboard({ id: DASHBOARD_STUDENT_ID, role: "teacher" }), /student's own session/);
    await assert.rejects(loader.readStudentSupport({ id: DASHBOARD_STUDENT_ID, role: "teacher" }), /student's own session/);
  });

  it("two students with different rows never see each other's values, first read or cached", async () => {
    const fixtures: QueryFixtures = {
      ...DASHBOARD_FIXTURES,
      "goal.count": perStudent(2, 0),
      "studentAlert.count": perStudent(1, 4),
      "application.count": perStudent(1, 9),
      "progression.findUnique": perStudent(
        { state: JSON.stringify(createInitialState()) },
        { state: JSON.stringify({ ...createInitialState(), orientationComplete: true }) },
      ),
    };
    counter.useFixtures(fixtures);
    for (let pass = 0; pass < 2; pass++) {
      const [mine, theirs] = await Promise.all([
        loader.loadStudentDashboard(student(DASHBOARD_STUDENT_ID), NOW),
        loader.loadStudentDashboard(student(OTHER_ID), NOW),
      ]);
      assert.equal(mine.goalCount, 2, `pass ${pass}`);
      assert.equal(theirs.goalCount, 0, `pass ${pass}`);
      assert.equal(mine.support.alertCount, 1, `pass ${pass}`);
      assert.equal(theirs.support.alertCount, 4, `pass ${pass}`);
      assert.match(mine.overview.outcomes[2].value, /^1 applications/);
      assert.match(theirs.overview.outcomes[2].value, /^9 applications/);
      assert.equal(mine.readinessData.state.orientationComplete, false);
      assert.equal(theirs.readinessData.state.orientationComplete, true);
    }
  });

  it("does not keep a shell with no Progression row, so a lost RLS context is read again", async () => {
    counter.useFixtures({ ...DASHBOARD_FIXTURES, "progression.findUnique": null, "goal.count": 0, "orientationProgress.count": 0 });
    await loader.loadStudentDashboard(student(DASHBOARD_STUDENT_ID), NOW);
    counter.useFixtures(DASHBOARD_FIXTURES);
    const { queries } = await counter.section(() => loader.loadStudentDashboard(student(DASHBOARD_STUDENT_ID), NOW));
    assert.ok(queries.some((q) => q.model === "progression"), "the empty shell was kept");
  });
});

/** Models only the slow signals read; a poll that touches none served them kept. */
const SLOW_MODELS = new Set(["careerDiscovery", "message", "certification", "portfolioItem", "resumeData", "publicCredentialPage", "studentClassEnrollment", "formSubmission"]);
/** Models the advising poll must read every time: nothing invalidates them. */
const LIVE_MODELS = ["studentAlert", "appointment", "studentSavedJob", "application", "studentTask"];
const modelsRead = async (work: () => Promise<unknown>) => new Set((await counter.section(work)).queries.map((q) => q.model));

describe("the polls read slow signals kept by the page, live ones every time", () => {
  it("the advising poll after a page render reads no slow model and every live one", async () => {
    await loader.loadStudentDashboard(student(DASHBOARD_STUDENT_ID), NOW);
    const read = await modelsRead(() => loader.readStudentSupport(student(DASHBOARD_STUDENT_ID), NOW));
    assert.deepEqual([...read].filter((model) => SLOW_MODELS.has(model)), []);
    for (const model of LIVE_MODELS) assert.ok(read.has(model), `${model} was not read live`);
  });

  it("the overview poll matches readOverview and reads only the live application count", async () => {
    await loader.loadStudentDashboard(student(DASHBOARD_STUDENT_ID), NOW);
    const read = await modelsRead(() => loader.readStudentOverview(student(DASHBOARD_STUDENT_ID), NOW));
    assert.deepEqual([...read], ["application"]);
    const polled = await loader.readStudentOverview(student(DASHBOARD_STUDENT_ID), NOW);
    assert.deepEqual(polled.outcomes, (await readers.readOverview(DASHBOARD_STUDENT_ID)).outcomes);
  });

  it("a poll with nothing kept reads the slow signals and keeps them", async () => {
    assert.ok((await modelsRead(() => loader.readStudentSupport(student(DASHBOARD_STUDENT_ID), NOW))).has("careerDiscovery"));
    assert.ok(!(await modelsRead(() => loader.readStudentSupport(student(DASHBOARD_STUDENT_ID), NOW))).has("careerDiscovery"));
  });

  it("never keeps slow signals with no student rows, which is what a read without RLS context sees", async () => {
    counter.useFixtures({
      ...DASHBOARD_FIXTURES,
      "goal.count": 0, "goal.findFirst": null, "certification.count": 0, "certification.findMany": [], "portfolioItem.count": 0,
      "resumeData.findUnique": null, "publicCredentialPage.findUnique": null, "careerDiscovery.findUnique": null, "message.count": 0,
      "studentClassEnrollment.findFirst": null, "formSubmission.findFirst": null,
    });
    await loader.readStudentSupport(student(DASHBOARD_STUDENT_ID), NOW);
    assert.ok((await modelsRead(() => loader.readStudentSupport(student(DASHBOARD_STUDENT_ID), NOW))).has("careerDiscovery"));
  });

  it("a write that clears the student's chat context makes the next poll read again", async () => {
    await loader.loadStudentDashboard(student(DASHBOARD_STUDENT_ID), NOW);
    cache.invalidateChatContext(DASHBOARD_STUDENT_ID);
    assert.ok((await modelsRead(() => loader.readStudentSupport(student(DASHBOARD_STUDENT_ID), NOW))).has("careerDiscovery"));
  });

  it("kept slow signals never cross students", async () => {
    counter.useFixtures({
      ...DASHBOARD_FIXTURES,
      "careerDiscovery.findUnique": perStudent({ status: "complete" }, { status: "in_progress" }),
      "certification.findMany": perStudent(DASHBOARD_FIXTURES["certification.findMany"], []),
      "certification.count": perStudent(0, 3),
    });
    await loader.loadStudentDashboard(student(DASHBOARD_STUDENT_ID), NOW);
    await loader.loadStudentDashboard(student(OTHER_ID), NOW);
    // Each poll, served from what is kept, equals that student's own fresh read.
    for (const id of [DASHBOARD_STUDENT_ID, OTHER_ID]) {
      const polled = await loader.readStudentSupport(student(id), NOW);
      assert.deepEqual(polled.nextStep, await nextStep.getStudentNextStep(id), `next step for ${id}`);
    }
    const [myOverview, theirOverview] = await Promise.all([
      loader.readStudentOverview(student(DASHBOARD_STUDENT_ID), NOW),
      loader.readStudentOverview(student(OTHER_ID), NOW),
    ]);
    assert.deepEqual(myOverview.outcomes, (await readers.readOverview(DASHBOARD_STUDENT_ID)).outcomes);
    assert.deepEqual(theirOverview.outcomes, (await readers.readOverview(OTHER_ID)).outcomes);
    assert.match(myOverview.outcomes[1].detail, /Completion: in progress/);
    assert.match(theirOverview.outcomes[1].detail, /Completion: not started/);
  });
});
