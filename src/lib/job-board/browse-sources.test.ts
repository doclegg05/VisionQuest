import assert from "node:assert/strict";
import test from "node:test";
import { BROWSE_SOURCES, browseAdapters } from "./browse-sources";

test("BROWSE_SOURCES contains only keyless remote/ATS sources", () => {
  assert.deepEqual([...BROWSE_SOURCES].sort(), [
    "arbeitnow", "ashby", "greenhouse", "lever",
    "remoteok", "remotive", "smartrecruiters", "weworkremotely",
  ]);
});

test("browseAdapters returns adapters whose source is in BROWSE_SOURCES and are configured", () => {
  const adapters = browseAdapters();
  assert.ok(adapters.length > 0);
  for (const a of adapters) {
    assert.ok((BROWSE_SOURCES as readonly string[]).includes(a.source));
    assert.equal(a.isConfigured(), true);
  }
});
