// =============================================================================
// matching-quality's evidence shape.
//
// `details.skipped === true` is how a scorer tells the runner it skipped
// itself (scripts/bench/run.mjs). This suite lists the students it could not
// score, and that list must not live under the same key: it is evidence about
// a run that happened, not a declaration that the run did not.
// =============================================================================
import assert from "node:assert/strict";
import { it } from "node:test";

import { run } from "./matching-quality.mjs";

it("lists students it could not score as evidence, never under details.skipped", async () => {
  // No labels means no student has a `fit` lead, so every one is unscorable.
  const { metrics } = await run({ fixture: { pairs: [] } });
  const { details } = metrics.find((metric) => metric.id === "precision_at_3");

  assert.equal(details.skipped, undefined);
  assert.equal(details.studentsSkipped > 0, true);
  assert.equal(details.studentsSkippedSample.length, Math.min(5, details.studentsSkipped));
  assert.equal(typeof details.studentsSkippedSample[0].studentId, "string");
});
