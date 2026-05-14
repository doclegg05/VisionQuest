import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatJobWorkMode, inferJobWorkMode, isJobWorkMode } from "./work-mode";

describe("job work mode helpers", () => {
  it("identifies remote-first sources as remote jobs", () => {
    assert.equal(inferJobWorkMode({ source: "remotive", location: "United States" }), "remote");
  });

  it("identifies hybrid jobs before remote jobs", () => {
    assert.equal(inferJobWorkMode({ title: "Office Coordinator", location: "Hybrid remote in Charleston, WV" }), "hybrid");
  });

  it("keeps negated remote copy as local physical work", () => {
    assert.equal(inferJobWorkMode({ title: "Receptionist", description: "This is not remote." }), "onsite");
  });

  it("validates and formats supported work modes", () => {
    assert.equal(isJobWorkMode("remote"), true);
    assert.equal(isJobWorkMode("physical"), false);
    assert.equal(formatJobWorkMode("onsite"), "Local / in person");
  });
});
