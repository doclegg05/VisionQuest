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
  "coordinator RLS policies are going live (Slice D). App-layer helpers rely on " +
  "that collapse to fail closed; the biggest is buildManagedStudentWhere " +
  "(src/lib/classroom.ts), which builds an UNSCOPED student where-clause for " +
  "coordinators. Region-scope that helper and audit every call site before " +
  "shipping. See docs/plans/rls-enforcement-runbook.md → Slice D.";

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

    it("TRIPWIRE (Slice D): coerces coordinator claims to the student role", () => {
      // Unlike the generic unknown-role coercion above, this test names
      // "coordinator" on purpose: it MUST break the day Slice D makes the
      // header path coordinator-aware, so the developer audits the app-layer
      // helpers that rely on today's fail-closed collapse.
      const out = rlsHeadersFromClaims({ sub: "coord-1", role: "coordinator" });
      assert.equal(out[RLS_HEADER_ROLE], "student", SLICE_D_TRIPWIRE);
      assert.equal(out[RLS_HEADER_STUDENT_ID], "coord-1");
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
