import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../api-error";
import { DEMO_CREDENTIALS_REFUSAL } from "./copy";
import { assertNotDemoAccount, bookingAudienceFor, isDemoInstructor } from "./guards";

test("isDemoInstructor is true only for the demo instructor", () => {
  assert.equal(isDemoInstructor({ demoAccount: "instructor" }), true);
  assert.equal(isDemoInstructor({ demoAccount: "student" }), false);
  assert.equal(isDemoInstructor({}), false);
  assert.equal(isDemoInstructor({ demoAccount: undefined }), false);
});

test("assertNotDemoAccount lets a real person through", () => {
  assert.doesNotThrow(() => assertNotDemoAccount({}));
  assert.doesNotThrow(() => assertNotDemoAccount({ demoAccount: undefined }));
});

test("assertNotDemoAccount refuses both kinds of demo account with the credentials copy", () => {
  for (const demoAccount of ["student", "instructor"] as const) {
    assert.throws(
      () => assertNotDemoAccount({ demoAccount }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.statusCode === 403 &&
        error.code === "FORBIDDEN" &&
        error.message === DEMO_CREDENTIALS_REFUSAL,
    );
  }
});

test("assertNotDemoAccount uses a caller's own message when given one", () => {
  assert.throws(
    () => assertNotDemoAccount({ demoAccount: "student" }, "No can do."),
    (error: unknown) => error instanceof ApiError && error.message === "No can do.",
  );
});

test("bookingAudienceFor puts both kinds of demo account in the demo audience", () => {
  assert.equal(bookingAudienceFor({ demoAccount: "student" }), "demo");
  assert.equal(bookingAudienceFor({ demoAccount: "instructor" }), "demo");
});

test("bookingAudienceFor leaves every real person in the standard audience", () => {
  assert.equal(bookingAudienceFor({}), "standard");
  assert.equal(bookingAudienceFor({ demoAccount: undefined }), "standard");
});
