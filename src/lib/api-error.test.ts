import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  unauthorized,
  badRequest,
  notFound,
  conflict,
  rateLimited,
  withErrorHandler,
} from "./api-error";

// ---------------------------------------------------------------------------
// ApiError class
// ---------------------------------------------------------------------------

test("ApiError stores statusCode, message, and code", () => {
  const err = new ApiError(403, "Forbidden", "FORBIDDEN");

  assert.equal(err.statusCode, 403);
  assert.equal(err.message, "Forbidden");
  assert.equal(err.code, "FORBIDDEN");
});

test("ApiError sets name to ApiError", () => {
  const err = new ApiError(403, "Forbidden", "FORBIDDEN");

  assert.equal(err.name, "ApiError");
});

test("ApiError is an instance of Error", () => {
  const err = new ApiError(500, "Boom");

  assert.ok(err instanceof Error);
  assert.ok(err instanceof ApiError);
});

test("ApiError code is optional and defaults to undefined", () => {
  const err = new ApiError(400, "Bad input");

  assert.equal(err.code, undefined);
});

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

test("unauthorized() returns 401 with default message and UNAUTHORIZED code", () => {
  const err = unauthorized();

  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Unauthorized");
  assert.equal(err.code, "UNAUTHORIZED");
});

test("unauthorized() accepts a custom message", () => {
  const err = unauthorized("Token expired");

  assert.equal(err.statusCode, 401);
  assert.equal(err.message, "Token expired");
  assert.equal(err.code, "UNAUTHORIZED");
});

test("badRequest() returns 400 with provided message and BAD_REQUEST code", () => {
  const err = badRequest("Missing required field");

  assert.equal(err.statusCode, 400);
  assert.equal(err.message, "Missing required field");
  assert.equal(err.code, "BAD_REQUEST");
});

test("notFound() returns 404 with default message and NOT_FOUND code", () => {
  const err = notFound();

  assert.equal(err.statusCode, 404);
  assert.equal(err.message, "Not found");
  assert.equal(err.code, "NOT_FOUND");
});

test("notFound() accepts a custom message", () => {
  const err = notFound("Course not found");

  assert.equal(err.statusCode, 404);
  assert.equal(err.message, "Course not found");
  assert.equal(err.code, "NOT_FOUND");
});

test("conflict() returns 409 with provided message and CONFLICT code", () => {
  const err = conflict("Email already registered");

  assert.equal(err.statusCode, 409);
  assert.equal(err.message, "Email already registered");
  assert.equal(err.code, "CONFLICT");
});

test("rateLimited() returns 429 with default message and RATE_LIMITED code", () => {
  const err = rateLimited();

  assert.equal(err.statusCode, 429);
  assert.equal(err.message, "Too many requests, please try again later");
  assert.equal(err.code, "RATE_LIMITED");
});

test("rateLimited() accepts a custom message", () => {
  const err = rateLimited("Slow down");

  assert.equal(err.statusCode, 429);
  assert.equal(err.message, "Slow down");
  assert.equal(err.code, "RATE_LIMITED");
});

// ---------------------------------------------------------------------------
// withErrorHandler — successful response pass-through
// ---------------------------------------------------------------------------

test("withErrorHandler passes through the response from a successful handler", async () => {
  const handler = withErrorHandler(async () => {
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ ok: true }, { status: 200 });
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true });
});

test("withErrorHandler forwards handler arguments to the inner function", async () => {
  const received: unknown[] = [];

  const handler = withErrorHandler(async (a: string, b: number) => {
    received.push(a, b);
    const { NextResponse } = await import("next/server");
    return NextResponse.json({}, { status: 200 });
  });

  await handler("hello", 42);

  assert.deepEqual(received, ["hello", 42]);
});

// ---------------------------------------------------------------------------
// withErrorHandler — ApiError caught and serialised
// ---------------------------------------------------------------------------

test("withErrorHandler returns the ApiError statusCode as the HTTP status", async () => {
  const handler = withErrorHandler(async () => {
    throw badRequest("name is required");
  });

  const response = await handler();

  assert.equal(response.status, 400);
});

test("withErrorHandler returns the ApiError message in the JSON body", async () => {
  const handler = withErrorHandler(async () => {
    throw badRequest("name is required");
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(body.error, "name is required");
});

test("withErrorHandler includes the code field for ApiErrors", async () => {
  const handler = withErrorHandler(async () => {
    throw conflict("duplicate key");
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(body.code, "CONFLICT");
});

test("withErrorHandler returns 401 for unauthorized()", async () => {
  const handler = withErrorHandler(async () => {
    throw unauthorized();
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error, "Unauthorized");
  assert.equal(body.code, "UNAUTHORIZED");
});

test("withErrorHandler returns 404 for notFound()", async () => {
  const handler = withErrorHandler(async () => {
    throw notFound();
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error, "Not found");
  assert.equal(body.code, "NOT_FOUND");
});

test("withErrorHandler returns 429 for rateLimited()", async () => {
  const handler = withErrorHandler(async () => {
    throw rateLimited();
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(body.code, "RATE_LIMITED");
});

// ---------------------------------------------------------------------------
// withErrorHandler — unknown errors produce 500
// ---------------------------------------------------------------------------

test("withErrorHandler returns 500 for an unknown Error", async () => {
  const handler = withErrorHandler(async () => {
    throw new Error("database connection lost");
  });

  const response = await handler();

  assert.equal(response.status, 500);
});

test("withErrorHandler returns Internal server error message for unknown errors", async () => {
  const handler = withErrorHandler(async () => {
    throw new Error("database connection lost");
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(body.error, "Internal server error");
});

test("withErrorHandler returns INTERNAL_ERROR code for unknown errors", async () => {
  const handler = withErrorHandler(async () => {
    throw new Error("database connection lost");
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(body.code, "INTERNAL_ERROR");
});

test("withErrorHandler returns 500 for a thrown non-Error value", async () => {
  const handler = withErrorHandler(async () => {
    throw new Error("something went wrong");
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.error, "Internal server error");
});
