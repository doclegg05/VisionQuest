import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applicationStatusLabel,
  eventRegistrationStatusLabel,
  humanizeStatusValue,
} from "./status-labels";

describe("status label helpers", () => {
  it("de-underscores multi-word statuses and capitalizes the first word", () => {
    assert.equal(humanizeStatusValue("under_review"), "Under review");
    assert.equal(humanizeStatusValue("no_show"), "No show");
  });

  it("capitalizes single-word statuses", () => {
    assert.equal(humanizeStatusValue("accepted"), "Accepted");
    assert.equal(humanizeStatusValue("registered"), "Registered");
  });

  it("normalizes stray whitespace and casing", () => {
    assert.equal(humanizeStatusValue(" INTERVIEWING "), "Interviewing");
    assert.equal(humanizeStatusValue("Under_Review"), "Under review");
  });

  it("returns the input unchanged when nothing remains after trimming", () => {
    assert.equal(humanizeStatusValue(""), "");
    assert.equal(humanizeStatusValue("_"), "_");
  });

  it("labels application statuses", () => {
    assert.equal(applicationStatusLabel("under_review"), "Under review");
    assert.equal(applicationStatusLabel("interviewing"), "Interviewing");
    assert.equal(applicationStatusLabel("accepted"), "Accepted");
  });

  it("labels event registration statuses", () => {
    assert.equal(eventRegistrationStatusLabel("registered"), "Registered");
    assert.equal(eventRegistrationStatusLabel("cancelled"), "Cancelled");
  });
});
