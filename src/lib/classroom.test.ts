import assert from "node:assert/strict";
import test from "node:test";
import {
  NON_ARCHIVED_ENROLLMENT_STATUSES,
  buildManagedStudentWhere,
  createClassInviteToken,
  hashInviteToken,
  normalizeClassCode,
  normalizeInviteInput,
} from "./classroom";
import { getRoleHomePath } from "./role-home";

test("normalizeClassCode creates a stable class slug", () => {
  assert.equal(normalizeClassCode("  SPOKES Class 2026 / AM  "), "spokes-class-2026-am");
});

test("createClassInviteToken returns a token and matching hash", () => {
  const invite = createClassInviteToken();

  assert.ok(invite.token.length >= 30);
  assert.equal(invite.tokenHash, hashInviteToken(invite.token));
});

test("normalizeInviteInput normalizes email and suggested student id", () => {
  const normalized = normalizeInviteInput({
    email: " Student@Example.com ",
    displayName: "  Jane Doe ",
    suggestedStudentId: " JD 123 ",
  });

  assert.deepEqual(normalized, {
    email: "student@example.com",
    displayName: "Jane Doe",
    suggestedStudentId: "jd123",
  });
});

test("buildManagedStudentWhere returns unrestricted admin access when no class is selected", () => {
  const where = buildManagedStudentWhere(
    {
      id: "admin-1",
      studentId: "admin-1",
      displayName: "Admin",
      role: "admin",
    },
    { includeInactiveAccounts: false },
  );

  assert.deepEqual(where, {
    role: "student",
    isActive: true,
  });
});

test("buildManagedStudentWhere scopes teachers to their class roster", () => {
  const where = buildManagedStudentWhere(
    {
      id: "teacher-1",
      studentId: "teacher-1",
      displayName: "Teacher",
      role: "teacher",
    },
    { classId: "class-1" },
  );

  assert.deepEqual(where, {
    role: "student",
    classEnrollments: {
      some: {
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
        classId: "class-1",
        class: {
          instructors: {
            some: { instructorId: "teacher-1" },
          },
        },
      },
    },
  });
});

test("getRoleHomePath routes each role to the correct landing page", () => {
  assert.equal(getRoleHomePath("admin"), "/admin");
  assert.equal(getRoleHomePath("teacher"), "/teacher");
  assert.equal(getRoleHomePath("student"), "/dashboard");
});
