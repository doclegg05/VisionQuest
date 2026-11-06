import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RLS_HEADER_USER_ID,
  RLS_HEADER_ROLE,
  RLS_HEADER_STUDENT_ID,
  rlsContextFromHeaders,
  rlsHeadersFromClaims,
} from "./rls-headers";

function headerBag(record: Record<string, string>) {
  return {
    get: (name: string) => record[name] ?? null,
  };
}

const SLICE_D_TRIPWIRE =
  "The middleware header path no longer collapses coordinators to \"student\" — " +
  "coordinator RLS policies are going live (Slice D). Audit the app-layer " +
  "helpers that pair with that collapse: buildManagedStudentWhere " +
  "(src/lib/classroom.ts) currently fails closed for coordinators (impossible " +
  "id-in-[] clause). Replace that branch with real region scoping (mirror " +
  "getCoordinatorInterventionQueue in src/lib/teacher/dashboard.ts) and audit " +
  "every call site before shipping. " +
  "See docs/plans/rls-enforcement-runbook.md → Slice D.";

describe("rls-headers", () => {
  describe("rlsHeadersFromClaims", () => {
    it("maps a student claim to user/role/studentId headers", () => {
      const out = rlsHeadersFromClaims({ sub: "stu_123", role: "student" });
      assert.equal(out[RLS_HEADER_USER_ID], "stu_123");
      assert.equal(out[RLS_HEADER_ROLE], "student");
      assert.equal(out[RLS_HEADER_STUDENT_ID], "stu_123");
    });

    it("maps a teacher claim with empty studentId", () => {
      const out = rlsHeadersFromClaims({ sub: "tea_1", role: "teacher" });
      assert.equal(out[RLS_HEADER_USER_ID], "tea_1");
      assert.equal(out[RLS_HEADER_ROLE], "teacher");
      assert.equal(out[RLS_HEADER_STUDENT_ID], "");
    });

    it("maps an admin claim with empty studentId", () => {
      const out = rlsHeadersFromClaims({ sub: "adm_1", role: "admin" });
      assert.equal(out[RLS_HEADER_ROLE], "admin");
      assert.equal(out[RLS_HEADER_STUDENT_ID], "");
    });

    it("coerces unknown roles to student", () => {
      // Defense in depth: if someone managed to sign a JWT with a garbage
      // role, treat them as a student (least privilege).
      const out = rlsHeadersFromClaims({ sub: "x", role: "superuser" });
      assert.equal(out[RLS_HEADER_ROLE], "student");
      assert.equal(out[RLS_HEADER_STUDENT_ID], "x");
    });

    // The organization tree (2026-11): both coordinator roles read through
    // the teacher RLS branches, scoped by managed_student_ids.
    for (const role of ["coordinator", "program_coordinator"]) {
      it(`maps a ${role} claim to the teacher role with empty studentId`, () => {
        const out = rlsHeadersFromClaims({ sub: "coord-1", role });
        assert.deepEqual(out, {
          [RLS_HEADER_USER_ID]: "coord-1",
          [RLS_HEADER_ROLE]: "teacher",
          [RLS_HEADER_STUDENT_ID]: "",
        });
      });

      it(`round-trips a ${role} claim through rlsContextFromHeaders`, () => {
        const ctx = rlsContextFromHeaders(headerBag(rlsHeadersFromClaims({ sub: "coord-1", role })));
        assert.deepEqual(ctx, { userId: "coord-1", role: "teacher", studentId: "" });
      });
    }

    it("keeps cdc claims on the student role", () => {
      const out = rlsHeadersFromClaims({ sub: "cdc-1", role: "cdc" });
      assert.equal(out[RLS_HEADER_ROLE], "student");
      assert.equal(out[RLS_HEADER_STUDENT_ID], "cdc-1");
    });
  });

  describe("rlsContextFromHeaders", () => {
    it("reconstructs a student context", () => {
      const ctx = rlsContextFromHeaders(
        headerBag({
          [RLS_HEADER_USER_ID]: "stu_1",
          [RLS_HEADER_ROLE]: "student",
          [RLS_HEADER_STUDENT_ID]: "stu_1",
        }),
      );
      assert.deepEqual(ctx, { userId: "stu_1", role: "student", studentId: "stu_1" });
    });

    it("reconstructs a teacher context with empty studentId", () => {
      const ctx = rlsContextFromHeaders(
        headerBag({
          [RLS_HEADER_USER_ID]: "tea_1",
          [RLS_HEADER_ROLE]: "teacher",
          [RLS_HEADER_STUDENT_ID]: "",
        }),
      );
      assert.deepEqual(ctx, { userId: "tea_1", role: "teacher", studentId: "" });
    });

    it("returns null when the user id header is missing", () => {
      const ctx = rlsContextFromHeaders(
        headerBag({
          [RLS_HEADER_ROLE]: "student",
          [RLS_HEADER_STUDENT_ID]: "stu_1",
        }),
      );
      assert.equal(ctx, null);
    });

    it("returns null when the role header is missing", () => {
      const ctx = rlsContextFromHeaders(
        headerBag({
          [RLS_HEADER_USER_ID]: "stu_1",
          [RLS_HEADER_STUDENT_ID]: "stu_1",
        }),
      );
      assert.equal(ctx, null);
    });

    it("returns null when the role header is an unknown value", () => {
      const ctx = rlsContextFromHeaders(
        headerBag({
          [RLS_HEADER_USER_ID]: "x",
          [RLS_HEADER_ROLE]: "superuser",
          [RLS_HEADER_STUDENT_ID]: "x",
        }),
      );
      assert.equal(ctx, null);
    });

    it("TRIPWIRE (Slice D): rejects a coordinator role header (fails closed)", () => {
      const ctx = rlsContextFromHeaders(
        headerBag({
          [RLS_HEADER_USER_ID]: "coord-1",
          [RLS_HEADER_ROLE]: "coordinator",
          [RLS_HEADER_STUDENT_ID]: "",
        }),
      );
      assert.equal(ctx, null, SLICE_D_TRIPWIRE);
    });

    it("returns null when role is student but studentId is empty", () => {
      const ctx = rlsContextFromHeaders(
        headerBag({
          [RLS_HEADER_USER_ID]: "stu_1",
          [RLS_HEADER_ROLE]: "student",
          [RLS_HEADER_STUDENT_ID]: "",
        }),
      );
      assert.equal(ctx, null);
    });

    it("returns null when the header bag is empty", () => {
      const ctx = rlsContextFromHeaders(headerBag({}));
      assert.equal(ctx, null);
    });
  });
});
