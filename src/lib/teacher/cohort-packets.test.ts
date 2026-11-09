/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Coordinators read as tree readers, and RLS hides every FileUpload row from
// them (file_upload_tree_reader_block), so the RLS client's file read returns
// nothing for a coordinator. The mock models that: the RLS client finds no
// file, the admin client finds the packet.

const rlsFileFindMany = mock.fn(async (_args?: unknown) => [] as unknown[]) as any;
const adminFileFindMany = mock.fn(async (_args?: unknown) => [{ id: "f1", storageKey: "packets/s1.pdf" }]) as any;
const studentFindMany = mock.fn(async (_args?: unknown) => [
  {
    id: "s1",
    displayName: "A B",
    studentId: "login-s1",
    spokesRecord: { firstName: "A", lastName: "B" },
    formSubmissions: [{ fileId: "f1" }],
  },
]) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: { student: { findMany: studentFindMany }, fileUpload: { findMany: rlsFileFindMany } },
    prismaAdmin: { fileUpload: { findMany: adminFileFindMany } },
  },
});

let mod: typeof import("./cohort-packets");
before(async () => {
  mod = await import("./cohort-packets");
});

beforeEach(() => {
  for (const fn of [rlsFileFindMany, adminFileFindMany, studentFindMany]) fn.mock.resetCalls();
});

describe("listCohortPacketStudents", () => {
  it("finds the packet even when RLS hides FileUpload from the caller", async () => {
    const [row] = await mod.listCohortPacketStudents(["s1"]);
    assert.equal(row.storageKey, "packets/s1.pdf");
  });

  it("reads only the scoped students' own files, and only the storage key", async () => {
    await mod.listCohortPacketStudents(["s1"]);
    const args = adminFileFindMany.mock.calls[0].arguments[0];
    assert.deepEqual(args.where, { id: { in: ["f1"] }, studentId: { in: ["s1"] } });
    assert.deepEqual(args.select, { id: true, storageKey: true });
  });

  it("reads no file when no student has a packet", async () => {
    studentFindMany.mock.mockImplementationOnce(async () => [
      { id: "s1", displayName: "A B", studentId: "login-s1", spokesRecord: null, formSubmissions: [] },
    ]);
    const [row] = await mod.listCohortPacketStudents(["s1"]);
    assert.equal(row.storageKey, null);
    assert.equal(adminFileFindMany.mock.callCount(), 0);
  });
});
