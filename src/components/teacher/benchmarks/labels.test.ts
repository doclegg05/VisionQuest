import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { AREA_LABEL } from "./labels";

// ---------------------------------------------------------------------------
// AREA_LABEL is how the benchmark admin page (src/app/(teacher)/teacher/admin/
// benchmarks/page.tsx) turns a suite config's `area` into a heading a
// non-coder can read. `areaLabel()` falls back to the raw area word when a
// label is missing, so a config that lands with a new area silently prints
// as e.g. "nudges" instead of failing anything — this test is the guard
// `areaLabel()` cannot be, since its whole point is to never throw.
//
// So this reads every real suite config, the same source the dashboard
// reads, and asserts AREA_LABEL has an entry for each distinct area it
// finds — not just that `areaLabel()` returns something.
// ---------------------------------------------------------------------------

// The repo root, resolved the way every other path-reading test here does it
// (`process.cwd()`): tsx compiles these to CJS, where `import.meta.dirname` is
// undefined and fails at load time rather than in an assertion.
const REPO_ROOT = process.cwd();

/** Files under config/benchmarks/ that are schemas, not suite configs. */
const NON_SUITE_FILES = new Set(["result.schema.json"]);

function distinctConfiguredAreas(): string[] {
  const dir = path.join(REPO_ROOT, "config", "benchmarks");
  const areas = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (NON_SUITE_FILES.has(entry.name)) continue;
    const config = JSON.parse(readFileSync(path.join(dir, entry.name), "utf8")) as {
      area?: unknown;
    };
    if (typeof config.area === "string" && config.area.length > 0) {
      areas.add(config.area);
    }
  }
  return [...areas].sort();
}

describe("AREA_LABEL", () => {
  it("covers every area used by a real config/benchmarks/*.json suite", () => {
    const areas = distinctConfiguredAreas();
    // A change to the discovery logic above that stops finding anything would
    // otherwise pass this test vacuously.
    assert.ok(
      areas.length > 5,
      `expected several distinct areas across config/benchmarks/*.json, found: ${areas.join(", ")}`,
    );

    const missing = areas.filter(
      (area) => !Object.prototype.hasOwnProperty.call(AREA_LABEL, area),
    );
    assert.deepEqual(
      missing,
      [],
      `AREA_LABEL has no plain-English label for: ${missing.join(", ")}. ` +
        `Add one to src/components/teacher/benchmarks/labels.ts.`,
    );
  });
});
