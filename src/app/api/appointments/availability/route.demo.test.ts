import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Cohort demo mode: GET /api/appointments/availability serves each booking
// audience from its own cache entry.
//
// The route used to cache one global entry, "advisors:bookable". With demo
// mode on, the first viewer to fill that entry would decide what every other
// viewer sees: a real student could be shown the demo instructor, and a demo
// student could be shown real staff. The cache below is a real Map keyed by
// the key the route passes, so a shared key shows up as one audience getting
// the other's advisors.
// ---------------------------------------------------------------------------

type Advisor = { advisorId: string; advisorName: string; slots: unknown[] };

const REAL_ADVISORS: Advisor[] = [{ advisorId: "adv-real", advisorName: "Ms. Legg", slots: [] }];
const DEMO_ADVISORS: Advisor[] = [
  { advisorId: "adv-demo", advisorName: "Demo Instructor", slots: [] },
];

let currentSession: Session = mockStudentSession();

const cacheStore = new Map<string, unknown>();
const cachedCalls: Array<{ key: string; ttlSeconds: number }> = [];

const mockListBookableAdvisors = mock.fn(
  async (options?: { audience?: "demo" | "standard" }): Promise<Advisor[]> =>
    options?.audience === "demo" ? DEMO_ADVISORS : REAL_ADVISORS,
);

mock.module("@/lib/api-error", {
  exports: {
    withAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) =>
        handler(currentSession, ...args),
    forbidden: (message = "Forbidden") => new Error(message),
  },
});

mock.module("@/lib/cache", {
  exports: {
    cached: async <T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> => {
      cachedCalls.push({ key, ttlSeconds });
      if (cacheStore.has(key)) return cacheStore.get(key) as T;
      const value = await fetcher();
      cacheStore.set(key, value);
      return value;
    },
  },
});

mock.module("@/lib/advising", {
  exports: { listBookableAdvisors: mockListBookableAdvisors },
});

let route: typeof import("./route");
before(async () => {
  route = await import("./route");
});

async function get(session: Session): Promise<Advisor[]> {
  currentSession = session;
  const response = await route.GET();
  const body = (await response.json()) as { advisors: Advisor[] };
  return body.advisors;
}

const DEMO_STUDENT = mockStudentSession({ id: "stu-demo-001", demoAccount: "student" });
const DEMO_INSTRUCTOR = mockTeacherSession({ id: "tch-demo-001", demoAccount: "instructor" });
const REAL_STUDENT = mockStudentSession({ id: "stu-real-001" });
const REAL_TEACHER = mockTeacherSession({ id: "tch-real-001" });

describe("GET /api/appointments/availability, by booking audience", () => {
  beforeEach(() => {
    cacheStore.clear();
    cachedCalls.length = 0;
    mockListBookableAdvisors.mock.resetCalls();
  });

  it("caches each audience under its own key", async () => {
    await get(DEMO_STUDENT);
    await get(REAL_STUDENT);

    assert.deepEqual(
      cachedCalls.map((call) => call.key),
      ["advisors:bookable:demo", "advisors:bookable:standard"],
    );
    assert.ok(
      cachedCalls.every((call) => call.ttlSeconds === 120),
      "the 120 second lifetime is unchanged",
    );
  });

  it("puts the demo instructor in the demo audience too", async () => {
    await get(DEMO_INSTRUCTOR);
    await get(REAL_TEACHER);

    assert.deepEqual(
      cachedCalls.map((call) => call.key),
      ["advisors:bookable:demo", "advisors:bookable:standard"],
    );
  });

  it("gives a demo student only the demo instructor, even after a real student filled the cache", async () => {
    await get(REAL_STUDENT);
    const advisors = await get(DEMO_STUDENT);

    assert.deepEqual(
      advisors.map((advisor) => advisor.advisorId),
      ["adv-demo"],
    );
  });

  it("gives a real student no demo instructor, even after a demo student filled the cache", async () => {
    await get(DEMO_STUDENT);
    const advisors = await get(REAL_STUDENT);

    assert.deepEqual(
      advisors.map((advisor) => advisor.advisorId),
      ["adv-real"],
    );
  });

  it("asks for each audience's advisors by name", async () => {
    await get(DEMO_STUDENT);
    await get(REAL_STUDENT);

    assert.deepEqual(
      mockListBookableAdvisors.mock.calls.map((call) => call.arguments[0]),
      [{ audience: "demo" }, { audience: "standard" }],
    );
  });
});
