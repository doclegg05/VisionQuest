/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding stands in for archiver and storage. */
import assert from "node:assert/strict";
import path from "node:path";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * A student's own upload filename must never become a ZIP entry path.
 *
 * `FileUpload.filename` is `File.name` persisted verbatim — undici keeps
 * `filename="../../../../home/staff/.bashrc"` intact through
 * `req.formData()`, and `archiver` does not normalize entry names, so the
 * central directory of a retention archive would literally contain
 * `files/../../../../home/staff/.bashrc`. The archive is downloaded and
 * unzipped by staff and by admins during offboarding, so that is a zip-slip
 * write outside the extraction directory on any extractor that does not
 * normalize, and on one that DOES normalize it still lets a student plant
 * `files/../forms/DoHS Release.pdf` over a real signed form inside their
 * own archive.
 *
 * The archive boundary is the authoritative fix: whatever is in the database
 * — including rows written before upload-time sanitizing existed — must come
 * out as a flat, safe entry name.
 */

const appended: Array<{ name: string; content: unknown }> = [];

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

mock.module("./db", {
  namedExports: {
    prisma: {
      student: {
        get findUnique() {
          return mockStudentFindUnique;
        },
        update: mock.fn(async () => ({})),
      },
    },
  },
});

mock.module("./storage", {
  namedExports: {
    downloadFile: async () => ({ buffer: Buffer.from("bytes") }),
    uploadFile: async () => "archives/stu-1.zip",
  },
});

let generateStudentArchive: typeof import("./student-archive").generateStudentArchive;
let safeEntryName: typeof import("./student-archive").safeEntryName;

before(async () => {
  ({ generateStudentArchive, safeEntryName } = await import("./student-archive"));
});

interface FileRow {
  id: string;
  filename: string;
  storageKey: string;
  category: string;
}

function studentRow(options: {
  files?: FileRow[];
  formSubmissions?: Array<Record<string, unknown>>;
}) {
  return {
    id: "stu-1",
    studentId: "VQ-0001",
    displayName: "Test Student",
    formSubmissions: options.formSubmissions ?? [],
    files: options.files ?? [],
    certifications: [],
    portfolioItems: [],
    resumeData: null,
    workProfile: null,
    connections: [],
  };
}

/** Every entry name the archive emitted for real file content. */
function entryNames() {
  return appended.map((a) => a.name);
}

function assertNoTraversal(names: string[]) {
  for (const name of names) {
    assert.ok(
      !name.split("/").includes(".."),
      `entry name contains a ".." segment: ${JSON.stringify(name)}`,
    );
    assert.ok(!name.startsWith("/"), `entry name is absolute: ${JSON.stringify(name)}`);
    assert.ok(!name.includes("\\"), `entry name contains a backslash: ${JSON.stringify(name)}`);
    assert.ok(!name.includes("\u0000"), `entry name contains NUL: ${JSON.stringify(name)}`);
  }
}

describe("generateStudentArchive — entry names are not student-controlled paths", () => {
  beforeEach(() => {
    appended.length = 0;
    mockStudentFindUnique.mock.resetCalls();
  });

  it("flattens a traversal filename in the general files folder", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () =>
      studentRow({
        files: [
          {
            id: "f1",
            filename: "../../../../etc/cron.d/x",
            category: "general",
            storageKey: "k1",
          },
        ],
      }),
    );

    await generateStudentArchive("stu-1", "tch-1");

    assertNoTraversal(entryNames());
    assert.ok(
      appended.some((a) => a.name === "files/x"),
      `expected a flattened files/x entry, got ${JSON.stringify(entryNames())}`,
    );
  });

  it("flattens a traversal filename on a form submission and its signature", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () =>
      studentRow({
        files: [
          {
            id: "form-file",
            filename: "../../home/staff/.bashrc",
            category: "orientation",
            storageKey: "k2",
          },
          {
            id: "sig-file",
            filename: "..\\..\\windows\\system32\\evil.png",
            category: "signature",
            storageKey: "k3",
          },
        ],
        formSubmissions: [
          {
            formId: "attendance-contract",
            fileId: "form-file",
            signatureFileId: "sig-file",
            status: "pending",
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
            reviewedAt: null,
            reviewedBy: null,
          },
        ],
      }),
    );

    await generateStudentArchive("stu-1", "tch-1");

    assertNoTraversal(entryNames());
    assert.ok(
      appended.some((a) => a.name === "forms/bashrc"),
      `expected forms/bashrc, got ${JSON.stringify(entryNames())}`,
    );
    assert.ok(
      appended.some((a) => a.name === "signatures/evil.png"),
      `expected signatures/evil.png, got ${JSON.stringify(entryNames())}`,
    );
  });

  it("cannot plant a file next to or over a real signed form", async () => {
    // The normalizing-extractor case: even where nothing escapes the archive
    // root, `files/../forms/DoHS Release.pdf` lands in the forms folder.
    mockStudentFindUnique.mock.mockImplementation(async () =>
      studentRow({
        files: [
          {
            id: "f1",
            filename: "../forms/DoHS Release.pdf",
            category: "general",
            storageKey: "k1",
          },
        ],
      }),
    );

    await generateStudentArchive("stu-1", "tch-1");

    // Normalize the way an extractor would, then ask where the entry landed.
    // Checking the raw prefix passes for the wrong reason: the raw name starts
    // with "files/" while `path.posix.normalize` resolves it into forms/.
    const fileEntries = entryNames().filter((n) => n.startsWith("files/"));
    assert.equal(fileEntries.length, 1, `expected one general upload entry, got ${JSON.stringify(entryNames())}`);
    const resolved = path.posix.normalize(fileEntries[0]);
    assert.ok(
      resolved.startsWith("files/"),
      `a general upload resolved outside its folder: ${JSON.stringify(resolved)}`,
    );
    assert.equal(resolved, "files/DoHS Release.pdf");
  });

  it("gives two filenames that normalize to the same base distinct entries", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () =>
      studentRow({
        files: [
          { id: "f1", filename: "../report.pdf", category: "general", storageKey: "k1" },
          { id: "f2", filename: "sub/report.pdf", category: "resume", storageKey: "k2" },
          { id: "f3", filename: "report.pdf", category: "general", storageKey: "k3" },
        ],
      }),
    );

    await generateStudentArchive("stu-1", "tch-1");

    const fileEntries = entryNames().filter((n) => n.startsWith("files/"));
    assert.equal(fileEntries.length, 3, `expected 3 file entries, got ${JSON.stringify(fileEntries)}`);
    assert.equal(new Set(fileEntries).size, 3, `entry names collided: ${JSON.stringify(fileEntries)}`);
    assert.deepEqual(fileEntries, [
      "files/report.pdf",
      "files/report (2).pdf",
      "files/report (3).pdf",
    ]);
  });

  it("lists the sanitized entry name in the manifest, not the raw filename", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () =>
      studentRow({
        files: [
          {
            id: "f1",
            filename: "../../../../etc/cron.d/x",
            category: "general",
            storageKey: "k1",
          },
        ],
      }),
    );

    await generateStudentArchive("stu-1", "tch-1");

    const manifest = appended.find((a) => a.name === "manifest.json");
    assert.ok(manifest, "the bundle must contain manifest.json");
    const entries = JSON.parse(String(manifest!.content)).entries as Array<{ path: string }>;
    assertNoTraversal(entries.map((e) => e.path));
    assert.ok(entries.some((e) => e.path === "files/x"));
  });
});

describe("safeEntryName", () => {
  it("flattens traversal and separator forms", () => {
    assert.equal(safeEntryName("../../../../etc/cron.d/x"), "x");
    assert.equal(safeEntryName("..\\..\\home\\staff\\.bashrc"), "bashrc");
    assert.equal(safeEntryName("/absolute/path.pdf"), "path.pdf");
  });

  it("replaces characters outside the safe set", () => {
    assert.equal(safeEntryName("re;su|me*.pdf"), "re_su_me_.pdf");
    assert.equal(safeEntryName("resume\u0000.pdf"), "resume.pdf");
  });

  it("keeps the readable punctuation an ordinary filename uses", () => {
    assert.equal(safeEntryName("Resume 2026 (final) [v2].pdf"), "Resume 2026 (final) [v2].pdf");
  });

  it("preserves unicode letters", () => {
    assert.equal(safeEntryName("Currículum señor.pdf"), "Currículum señor.pdf");
  });

  it("strips leading dots and falls back when nothing is left", () => {
    assert.equal(safeEntryName(".."), "file");
    assert.equal(safeEntryName("..."), "file");
    assert.equal(safeEntryName(""), "file");
    assert.equal(safeEntryName("///"), "file");
  });

  it("caps the name at 120 characters", () => {
    const result = safeEntryName(`${"a".repeat(500)}.pdf`);
    assert.ok(result.length <= 120, `expected <= 120 chars, got ${result.length}`);
  });
});
