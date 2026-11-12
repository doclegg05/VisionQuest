/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding stands in for archiver, storage and the logger. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * The archive's storage key travels: it is written to the audit row's
 * metadata, logged at info, passed back as `?key=` and signed into the
 * presigned URL. So it must carry no part of the student's name (H15c
 * item 1). The student id already scopes it.
 */

let piped: { end: () => void } | null = null;
const archiveStub = {
  pipe: (destination: { end: () => void }) => {
    piped = destination;
  },
  append: () => undefined,
  finalize: async () => {
    piped?.end();
  },
  on: () => undefined,
};
mock.module("archiver", { defaultExport: () => archiveStub });

const DISPLAY_NAME = "Jane Quincy Okafor-Smith";
const NAME_PARTS = ["Jane", "Quincy", "Okafor", "Smith"];

mock.module("./db", {
  namedExports: {
    prisma: {
      student: {
        findUnique: async () => ({
          id: "stu-1",
          studentId: "VQ-0001",
          displayName: DISPLAY_NAME,
          formSubmissions: [],
          files: [],
          certifications: [],
          portfolioItems: [],
          resumeData: null,
          workProfile: null,
          connections: [],
        }),
        update: async () => ({}),
      },
    },
  },
});

const uploadMock = mock.fn(async (key: string) => key) as any;
mock.module("./storage", {
  namedExports: {
    downloadFile: async () => ({ buffer: Buffer.from("bytes") }),
    uploadFile: uploadMock,
  },
});

const infoMock = mock.fn() as any;
mock.module("./logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: infoMock, warn: mock.fn(), error: mock.fn() },
  },
});

let generateStudentArchive: typeof import("./student-archive").generateStudentArchive;

before(async () => {
  ({ generateStudentArchive } = await import("./student-archive"));
});

function assertNoNamePart(label: string, text: string): void {
  for (const part of NAME_PARTS) {
    assert.ok(
      !text.toLowerCase().includes(part.toLowerCase()),
      `${label} contains the name part "${part}": ${text}`,
    );
  }
}

describe("generateStudentArchive storage key", () => {
  beforeEach(() => {
    uploadMock.mock.resetCalls();
    infoMock.mock.resetCalls();
  });

  it("builds a key under the student's folder with no part of the name", async () => {
    const { storageKey } = await generateStudentArchive("stu-1", "tch-1");

    assert.match(storageKey, /^archives\/stu-1\/archive_\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.zip$/);
    assertNoNamePart("storage key", storageKey);
    assert.equal(uploadMock.mock.calls[0].arguments[0], storageKey);
  });

  it("two archives on the same day get different keys", async () => {
    const first = await generateStudentArchive("stu-1", "tch-1");
    const second = await generateStudentArchive("stu-1", "tch-1");
    assert.notEqual(first.storageKey, second.storageKey);
  });

  it("logs no part of the name", async () => {
    await generateStudentArchive("stu-1", "tch-1");
    assert.ok(infoMock.mock.calls.length > 0, "expected an info log for the archive");
    for (const call of infoMock.mock.calls) {
      assertNoNamePart("info log", JSON.stringify(call.arguments));
    }
  });
});
