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

function studentRow(workProfile: unknown) {
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
  };
}

describe("generateStudentArchive — work profile", () => {
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
});
