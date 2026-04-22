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
