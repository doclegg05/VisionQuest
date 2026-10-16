/**
 * Shared test utilities for API route and integration tests.
 *
 * These helpers create mock sessions and Request objects suitable for
 * testing Next.js App Router route handlers without a running server.
 */

import type { Session } from "./api-error";

// ---------------------------------------------------------------------------
// Mock session factories
// ---------------------------------------------------------------------------

export function mockStudentSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "stu-test-001",
    studentId: "testuser",
    displayName: "Test Student",
    role: "student",
    ...overrides,
  };
}

export function mockTeacherSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "tch-test-001",
    studentId: "testteacher",
    displayName: "Test Teacher",
    role: "teacher",
    ...overrides,
  };
}

export function mockAdminSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "adm-test-001",
    studentId: "testadmin",
    displayName: "Test Admin",
    role: "admin",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock request builder
// ---------------------------------------------------------------------------

interface MockRequestOptions {
  method?: string;
  body?: unknown;
  searchParams?: Record<string, string>;
  headers?: Record<string, string>;
}

export function mockRequest(
  path: string,
  options: MockRequestOptions = {},
): Request {
  const { method = "GET", body, searchParams, headers = {} } = options;

  const url = new URL(path, "http://localhost:3000");
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (body !== undefined && method !== "GET") {
    init.body = JSON.stringify(body);
  }

  return new Request(url.toString(), init);
}

// ---------------------------------------------------------------------------
// Response assertion helpers
// ---------------------------------------------------------------------------

export async function assertJsonResponse(
  response: Response,
  expectedStatus: number,
): Promise<unknown> {
  const body = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}. Body: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

export async function assertErrorResponse(
  response: Response,
  expectedStatus: number,
  expectedMessageSubstring?: string,
): Promise<{ error: string }> {
  const body = (await assertJsonResponse(response, expectedStatus)) as {
    error: string;
  };
  if (typeof body.error !== "string") {
    throw new Error(`Expected error field in response body, got: ${JSON.stringify(body)}`);
  }
  if (
    expectedMessageSubstring &&
    !body.error.toLowerCase().includes(expectedMessageSubstring.toLowerCase())
  ) {
    throw new Error(
      `Expected error to include "${expectedMessageSubstring}", got: "${body.error}"`,
    );
  }
  return body;
}

export async function assertCsvResponse(
  response: Response,
  expectedStatus = 200,
): Promise<string> {
  if (response.status !== expectedStatus) {
    throw new Error(`Expected status ${expectedStatus}, got ${response.status}`);
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/csv")) {
    throw new Error(`Expected Content-Type text/csv, got: ${contentType}`);
  }
  return response.text();
}

// ---------------------------------------------------------------------------
// Prisma where evaluation for in-memory fakes
// ---------------------------------------------------------------------------

type WhereClause = Record<string, unknown>;

function sameValue(value: unknown, expected: unknown): boolean {
  if (value instanceof Date && expected instanceof Date) return value.getTime() === expected.getTime();
  return value === expected;
}

function applyOperator(value: unknown, operator: string, operand: unknown): boolean {
  if (operator === "in") return (operand as unknown[]).some((candidate) => sameValue(value, candidate));
  // A comparison against NULL is never true in SQL, and Prisma sends these as SQL.
  if (value === null || value === undefined) return false;
  const left = value instanceof Date ? value.getTime() : value;
  const right = operand instanceof Date ? operand.getTime() : operand;
  switch (operator) {
    case "lt": return (left as number) < (right as number);
    case "lte": return (left as number) <= (right as number);
    case "gt": return (left as number) > (right as number);
    case "gte": return (left as number) >= (right as number);
    case "startsWith": return typeof value === "string" && value.startsWith(String(operand));
    default: throw new Error(`matchesWhere does not support the "${operator}" operator`);
  }
}

function matchesField(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== "object" || condition instanceof Date) {
    return sameValue(value, condition);
  }
  return Object.entries(condition).every(([operator, operand]) => applyOperator(value, operator, operand));
}

/**
 * Evaluate a Prisma where clause against an in-memory row, for fakes that
 * stand in for updateMany or findFirst. Supports equality (dates and null
 * included), lt / lte / gt / gte / in / startsWith, and AND / OR. Anything
 * else throws, so a fake never matches a filter it does not understand.
 */
export function matchesWhere(row: Record<string, unknown>, where: WhereClause): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as WhereClause[]).some((clause) => matchesWhere(row, clause));
    if (key === "AND") {
      const clauses = Array.isArray(condition) ? condition : [condition];
      return (clauses as WhereClause[]).every((clause) => matchesWhere(row, clause));
    }
    return matchesField(row[key], condition);
  });
}
