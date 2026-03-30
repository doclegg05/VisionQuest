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
