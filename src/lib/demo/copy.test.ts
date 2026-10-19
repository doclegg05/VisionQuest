import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_ENTER_INSTRUCTOR,
  DEMO_ENTER_STUDENT,
  DEMO_ENTRY_FAILED,
  DEMO_ENTRY_OFFLINE,
  DEMO_ENTRY_PENDING,
  DEMO_LIMIT_INSTRUCTOR,
  DEMO_LIMIT_NETWORK,
} from "./copy";

/**
 * The words the sign-in page shows for the demo choice and for a refused
 * request. The reading-level checks live in copy.readability.test.ts and the
 * ui-copy gate; this pins the exact wording from the UX review so a later
 * edit is a decision, not an accident.
 */
describe("demo sign-in copy", () => {
  it("says it is a demo on both buttons", () => {
    assert.equal(DEMO_ENTER_STUDENT, "Try the demo as a student");
    assert.equal(DEMO_ENTER_INSTRUCTOR, "Try the demo as an instructor");
  });

  it("shows progress while the request runs", () => {
    assert.equal(DEMO_ENTRY_PENDING, "Starting the demo...");
  });

  it("names the cause and the next step when a limit is hit", () => {
    assert.equal(
      DEMO_LIMIT_NETWORK,
      "Too many demo students were started from this network. Please try again in an hour.",
    );
    assert.equal(
      DEMO_LIMIT_INSTRUCTOR,
      "Too many instructor sign-ins just now. Please wait a few minutes and try again.",
    );
  });

  it("keeps the offline message apart from the unknown-reply message", () => {
    assert.equal(DEMO_ENTRY_OFFLINE, "We couldn't reach VisionQuest. Check your internet and try again.");
    assert.equal(DEMO_ENTRY_FAILED, "We could not start the demo. Please try again.");
  });
});
