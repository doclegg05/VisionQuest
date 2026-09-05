/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding stands in for archiver and storage. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * Export-before-deactivate has to carry the work profile.
 *
 * StudentWorkProfile is a new class of student-owned PII (home ZIP, transport,
 * pay floor, childcare hours) with its own retention row. Offboarding deletes
 * it along with the Student row, so if the archive does not contain it the
 * student never receives a copy of data they gave us — which is the whole
 * point of exporting first.
 */

const appended: Array<{ name: string; content: unknown }> = [];

/**
 * Minimal archiver stand-in. `pipe` remembers the destination and `finalize`
 * ends it, because generateStudentArchive awaits the buffer stream's "finish"
 * event — a no-op pipe would hang the test rather than fail it.
 */
let piped: { end: () => void } | null = null;
const archiveStub = {
  pipe: (destination: { end: () => void }) => {
    piped = destination;
  },
  append: (content: unknown, options: { name: string }) => {
    appended.push({ name: options.name, content });
  },
  finalize: async () => {
    piped?.end();
  },
  on: () => undefined,
};

mock.module("archiver", { defaultExport: () => archiveStub });

const mockStudentFindUnique = mock.fn(async () => null as any) as any;
const mockUpdate = mock.fn(async () => ({})) as any;

mock.module("./db", {
  namedExports: {
    prisma: {
      student: {
        get findUnique() {
          return mockStudentFindUnique;
        },
        update: mockUpdate,
      },
    },
  },
});

mock.module("./storage", {
  namedExports: {
    downloadFile: async () => Buffer.from(""),
    uploadFile: async () => "archives/stu-1.zip",
  },
});

let generateStudentArchive: typeof import("./student-archive").generateStudentArchive;

before(async () => {
  ({ generateStudentArchive } = await import("./student-archive"));
});

function studentRow(workProfile: unknown, connections: unknown[] = []) {
  return {
    id: "stu-1",
    studentId: "VQ-0001",
    displayName: "Test Student",
    formSubmissions: [],
    files: [],
    certifications: [],
    portfolioItems: [],
    resumeData: null,
    workProfile,
    connections,
  };
}

/** One disclosure record, in the shape the archive's own select returns. */
function connectionRow() {
  return {
    status: "sent",
    statusChangedAt: new Date("2026-09-04T00:00:00.000Z"),
    proposedVia: "teacher",
    packet: { includedFields: ["candidate_name", "resume"], candidateName: "Test S." },
    sentAt: new Date("2026-09-04T00:00:00.000Z"),
    employerViewedAt: null,
    employerRespondedAt: null,
    employerResponse: null,
    responseReason: null,
    hiredAt: null,
    startDate: null,
    hourlyWage: null,
    closedReason: null,
    createdAt: new Date("2026-09-03T00:00:00.000Z"),
    employer: { name: "Mountain Metal" },
    jobLead: { title: "Production Associate" },
    events: [
      {
        fromStatus: null,
        toStatus: "proposed",
        actorType: "teacher",
        note: null,
        at: new Date("2026-09-03T00:00:00.000Z"),
      },
    ],
  };
}

describe("generateStudentArchive — work profile and disclosures", () => {
  beforeEach(() => {
    appended.length = 0;
    mockStudentFindUnique.mock.resetCalls();
  });

  it("writes work-profile.json when the student has a work profile", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () =>
      studentRow({
        availability: {},
        transport: "bus",
        homeZip: "25301",
        county: "Kanawha",
        maxCommuteMinutes: 30,
        payFloorHourly: 15,
        childcareHours: { note: "Kids are at school 8 to 3." },
        earliestStart: null,
        shiftLimits: null,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-05T00:00:00.000Z"),
        updatedVia: "student",
      }),
    );

    await generateStudentArchive("stu-1", "tch-1");

    const entry = appended.find((a) => a.name === "work-profile.json");
    assert.ok(entry, "the bundle must contain work-profile.json");
    const parsed = JSON.parse(String(entry!.content));
    assert.equal(parsed.transport, "bus");
    assert.equal(parsed.homeZip, "25301");
    assert.equal(parsed.childcareHours.note, "Kids are at school 8 to 3.");

    // And the manifest lists it, so the student can see what they received.
    const manifest = appended.find((a) => a.name === "manifest.json");
    assert.ok(manifest);
    const entries = JSON.parse(String(manifest!.content)).entries as Array<{ path: string }>;
    assert.ok(entries.some((e) => e.path === "work-profile.json"));
  });

  it("writes no work-profile.json when the student has none", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => studentRow(null));
    await generateStudentArchive("stu-1", "tch-1");
    assert.equal(
      appended.some((a) => a.name === "work-profile.json"),
      false,
      "an empty file would imply the student answered and said nothing",
    );
  });

  it("writes connections.json — the record of who this program told about them", async () => {
    // Offboarding deletes the Connection rows along with the Student. Without
    // this file the student can never afterwards answer "who did SPOKES tell
    // about me, and what did they say", which is the point of exporting first.
    mockStudentFindUnique.mock.mockImplementation(async () =>
      studentRow(null, [connectionRow()]),
    );

    await generateStudentArchive("stu-1", "tch-1");

    const entry = appended.find((a) => a.name === "connections.json");
    assert.ok(entry, "the bundle must contain connections.json");
    const parsed = JSON.parse(String(entry!.content));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].employer, "Mountain Metal");
    assert.equal(parsed[0].job, "Production Associate");
    assert.equal(parsed[0].status, "sent");
    // The FIELDS they approved, read off the frozen packet — the honest answer
    // to "what was shared", rather than a second copy of the values.
    assert.deepEqual(parsed[0].sharedFields, ["candidate_name", "resume"]);
    assert.equal(parsed[0].events.length, 1);

    const manifest = appended.find((a) => a.name === "manifest.json");
    const entries = JSON.parse(String(manifest!.content)).entries as Array<{ path: string }>;
    assert.ok(entries.some((e) => e.path === "connections.json"));
  });

  it("carries no employer CONTACT details, only the employer's name", async () => {
    // A contact's email and phone are a third party's PII. They are not the
    // student's to be handed, and the employer-facing page never showed them
    // to the student either.
    mockStudentFindUnique.mock.mockImplementation(async () =>
      studentRow(null, [connectionRow()]),
    );

    await generateStudentArchive("stu-1", "tch-1");

    const entry = appended.find((a) => a.name === "connections.json");
    const serialized = String(entry!.content).toLowerCase();
    for (const never of ["contactemail", "contactphone", "employertokenhash", "tokencontactid"]) {
      assert.ok(!serialized.includes(never), `connections.json leaked "${never}"`);
    }
  });

  it("writes no connections.json when the student was never introduced to anyone", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => studentRow(null, []));
    await generateStudentArchive("stu-1", "tch-1");
    assert.equal(
      appended.some((a) => a.name === "connections.json"),
      false,
      "an empty array would imply a record that does not exist",
    );
  });
});
