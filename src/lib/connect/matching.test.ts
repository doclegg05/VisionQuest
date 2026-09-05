/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * rankStudentsForLead / rankLeadsForStudent — the loading half of the matcher.
 *
 * The load-bearing assertion here is the QUERY COUNT. Every scoring rule is
 * covered by matching-shared.test.ts against pure inputs; what a mocked client
 * can prove that pure tests cannot is that a roster of thirty students costs
 * the same four round trips as a roster of one.
 */

let calls: string[] = [];

function record<T>(name: string, value: (args: any) => T) {
  return mock.fn(async (args: any) => {
    calls.push(name);
    return value(args);
  }) as any;
}

const ROSTER_SIZE = 30;

function makeEnrollments(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    classId: "class-1",
    class: { jobConfig: { region: "Beckley, WV" } },
    student: {
      id: `stu-${index}`,
      displayName: `Student ${index}`,
      careerDiscovery: { topClusters: ["career-readiness"], hollandCode: "RSC", transferableSkills: null },
      resumeData: null,
      // Half the roster has the forklift card verified; the other half does
      // not, so the lead's must-have splits the group into fits and blocked.
      certifications: index % 2 === 0 ? [{ certType: "forklift-operator" }] : [],
    },
  }));
}

const leadRow = {
  id: "lead-1",
  title: "Production Associate",
  description: "Runs the press line.",
  employerId: "emp-1",
  status: "open",
  location: "Beckley, WV",
  clusters: ["career-readiness"],
  requirements: { mustHaveCerts: ["forklift-operator"], niceToHave: [], physical: [], licenses: [] },
  schedule: { shifts: ["day"] },
  payMin: 15,
  payMax: 18,
  payPeriod: "hour",
  transitNotes: null,
  distanceMiles: null,
  source: "manual",
  classId: "class-1",
  employer: {
    id: "emp-1",
    name: "Mountain Metal",
    status: "active",
    hiredSpokesGradBefore: true,
    subsidyFlags: { eip: "known" },
  },
};

const mockLeadFindUnique = record("jobLead.findUnique", () => leadRow);
const mockLeadFindMany = record("jobLead.findMany", () => [leadRow]);
const mockEnrollmentFindMany = record("enrollment.findMany", (args: any) =>
  args?.where?.studentId
    ? [{ classId: "class-1", class: { jobConfig: { region: "Beckley, WV" } } }]
    : makeEnrollments(ROSTER_SIZE),
);
const mockWorkProfileFindMany = record("workProfile.findMany", () => []);
const mockApplicationFindMany = record("application.findMany", () => []);
const mockDiscoveryFindUnique = record("careerDiscovery.findUnique", () => null);
const mockResumeFindUnique = record("resumeData.findUnique", () => null);
const mockCertFindMany = record("certification.findMany", () => [
  { certType: "forklift-operator" },
]);

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      jobLead: {
        get findUnique() {
          return mockLeadFindUnique;
        },
        get findMany() {
          return mockLeadFindMany;
        },
      },
      studentClassEnrollment: {
        get findMany() {
          return mockEnrollmentFindMany;
        },
      },
      studentWorkProfile: {
        get findMany() {
          return mockWorkProfileFindMany;
        },
      },
      application: {
        get findMany() {
          return mockApplicationFindMany;
        },
      },
      careerDiscovery: {
        get findUnique() {
          return mockDiscoveryFindUnique;
        },
      },
      resumeData: {
        get findUnique() {
          return mockResumeFindUnique;
        },
      },
      certification: {
        get findMany() {
          return mockCertFindMany;
        },
      },
    },
  },
});

let matching: Awaited<typeof import("./matching")>;

before(async () => {
  matching = await import("./matching");
});

beforeEach(() => {
  calls = [];
});

describe("rankStudentsForLead", () => {
  it("splits the roster into fits and hard-blocked students", async () => {
    const result = await matching.rankStudentsForLead("lead-1");
    assert.ok(result);
    assert.equal(result.fits.length + result.blocked.length, ROSTER_SIZE);
    assert.equal(
      result.blocked.length,
      ROSTER_SIZE / 2,
      "half the roster has no verified forklift card",
    );
    for (const entry of result.blocked) {
      assert.deepEqual(entry.fit.hardBlocks, ["missing_must_have_cert"]);
      assert.equal(entry.fit.blockReasons.length, 1);
    }
  });

  it("sorts fits best-first", async () => {
    const result = await matching.rankStudentsForLead("lead-1");
    const scores = result!.fits.map((entry) => entry.fit.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  it("issues a fixed four queries for a roster of thirty (N+1 guard)", async () => {
    await matching.rankStudentsForLead("lead-1");
    assert.deepEqual(
      calls,
      [
        "jobLead.findUnique",
        "enrollment.findMany",
        "workProfile.findMany",
        "application.findMany",
      ],
      `expected 4 queries, got ${calls.length}: ${calls.join(", ")}`,
    );
  });

  it("reads work profiles for the whole roster in one batched call", async () => {
    await matching.rankStudentsForLead("lead-1");
    const args = mockWorkProfileFindMany.mock.calls.at(-1)?.arguments[0];
    assert.equal(
      args.where.studentId.in.length,
      ROSTER_SIZE,
      "one `in` list, not one findUnique per student",
    );
  });

  it("returns null for a lead that does not exist", async () => {
    mockLeadFindUnique.mock.mockImplementationOnce(async () => {
      calls.push("jobLead.findUnique");
      return null;
    });
    assert.equal(await matching.rankStudentsForLead("nope"), null);
  });

  it("reports the subsidy flags as known/unknown, never as a bare boolean", async () => {
    const result = await matching.rankStudentsForLead("lead-1");
    assert.equal(result!.subsidyFlags.eip, "known");
    assert.equal(result!.subsidyFlags.esp, "unknown");
  });
});

describe("summarizeLeadFits", () => {
  it("counts fits and blocks per lead", async () => {
    const [counts] = await matching.summarizeLeadFits(["lead-1"]);
    assert.equal(counts.jobLeadId, "lead-1");
    assert.equal(counts.fitCount, ROSTER_SIZE / 2);
    assert.equal(counts.blockedCount, ROSTER_SIZE / 2);
  });

  it("costs the same three queries for one lead as for many (N+1 guard)", async () => {
    await matching.summarizeLeadFits(["lead-1", "lead-2", "lead-3"]);
    assert.deepEqual(
      calls,
      ["jobLead.findMany", "enrollment.findMany", "workProfile.findMany", "application.findMany"],
      `expected one query per source, got: ${calls.join(", ")}`,
    );
  });

  it("does nothing at all for an empty list", async () => {
    assert.deepEqual(await matching.summarizeLeadFits([]), []);
    assert.deepEqual(calls, [], "an empty board must not touch the database");
  });
});

describe("rankLeadsForStudent", () => {
  it("asks only for open leads that are program-wide or in one of the student's classes", async () => {
    await matching.rankLeadsForStudent("stu-1");
    const args = mockLeadFindMany.mock.calls.at(-1)?.arguments[0];
    assert.equal(args.where.status, "open");
    assert.deepEqual(args.where.OR, [{ classId: null }, { classId: { in: ["class-1"] } }]);
    assert.deepEqual(args.where.employer, { status: { not: "do_not_contact" } });
  });

  it("caps the number of leads it will rank", async () => {
    await matching.rankLeadsForStudent("stu-1", { limit: 5_000 });
    const args = mockLeadFindMany.mock.calls.at(-1)?.arguments[0];
    assert.equal(args.take, matching.MAX_LEADS);
  });

  it("drops hard-blocked leads from the student's own view", async () => {
    mockCertFindMany.mock.mockImplementationOnce(async () => {
      calls.push("certification.findMany");
      return [];
    });
    const results = await matching.rankLeadsForStudent("stu-1");
    assert.deepEqual(results, [], "the must-have cert is not verified for this student");
  });

  it("returns the lead with its fit when nothing blocks it", async () => {
    const results = await matching.rankLeadsForStudent("stu-1");
    assert.equal(results.length, 1);
    assert.equal(results[0].lead.employerName, "Mountain Metal");
    assert.ok(results[0].fit.score > 0);
    assert.ok(results[0].fit.reasons.length > 0);
  });
});
