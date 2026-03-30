import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mockStudentSession,
  mockTeacherSession,
  mockAdminSession,
  mockRequest,
} from "./test-helpers";

// ---------------------------------------------------------------------------
// Session factories
// ---------------------------------------------------------------------------

describe("mockStudentSession", () => {
  it("returns a student role by default", () => {
    const s = mockStudentSession();
    assert.equal(s.role, "student");
    assert.equal(typeof s.id, "string");
    assert.equal(typeof s.displayName, "string");
  });

  it("accepts overrides", () => {
    const s = mockStudentSession({ displayName: "Jane", id: "custom-id" });
    assert.equal(s.displayName, "Jane");
    assert.equal(s.id, "custom-id");
    assert.equal(s.role, "student");
  });
});

describe("mockTeacherSession", () => {
  it("returns a teacher role by default", () => {
    const s = mockTeacherSession();
    assert.equal(s.role, "teacher");
  });
});

describe("mockAdminSession", () => {
  it("returns an admin role by default", () => {
    const s = mockAdminSession();
    assert.equal(s.role, "admin");
  });
});

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

describe("mockRequest", () => {
  it("creates a GET request by default", () => {
    const req = mockRequest("/api/test");
    assert.equal(req.method, "GET");
    assert.ok(req.url.includes("/api/test"));
  });

  it("creates a POST request with JSON body", async () => {
    const req = mockRequest("/api/test", {
      method: "POST",
      body: { name: "test" },
    });
    assert.equal(req.method, "POST");
    const body = await req.json();
    assert.deepEqual(body, { name: "test" });
  });

  it("includes search params", () => {
    const req = mockRequest("/api/test", {
      searchParams: { classId: "cls-1", format: "csv" },
    });
    const url = new URL(req.url);
    assert.equal(url.searchParams.get("classId"), "cls-1");
    assert.equal(url.searchParams.get("format"), "csv");
  });

  it("includes custom headers", () => {
    const req = mockRequest("/api/test", {
      headers: { "X-Custom": "value" },
    });
    assert.equal(req.headers.get("X-Custom"), "value");
  });

  it("does not attach body for GET requests", () => {
    const req = mockRequest("/api/test", {
      method: "GET",
      body: { ignored: true },
    });
    assert.equal(req.body, null);
  });
});
