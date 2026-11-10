/**
 * Guards M1 and M6 against a layer they cannot see. Next.js renders every
 * `layout` and `template` file on the path down to a page, and each can read
 * the database. The dashboard and teacher-home measurements render the layers
 * listed below by hand; a new one above either page would run in production
 * and be missing from the count. This test fails when the set changes.
 *
 * `src/app/layout.tsx` is listed and not rendered: it reads only cookies and
 * headers, which the two measurement tests record as 0 "read, not executed".
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { routeLayers } from "./route-layers";

const ROOT = process.cwd();
const APP = path.join(ROOT, "src/app");

const MEASURED_PAGES = [
  {
    metric: "M1",
    test: "src/lib/readiness/dashboard-query-count.test.tsx",
    page: "src/app/(student)/dashboard",
    layers: ["src/app/layout.tsx", "src/app/(student)/layout.tsx"],
  },
  {
    metric: "M6",
    test: "src/lib/readiness/teacher-home-query-count.test.tsx",
    page: "src/app/(teacher)/teacher",
    layers: ["src/app/layout.tsx", "src/app/(teacher)/layout.tsx"],
  },
] as const;

describe("measured pages: the layouts and templates above them", () => {
  for (const measured of MEASURED_PAGES) {
    it(`${measured.metric}: ${measured.page} has the layers its measurement renders`, () => {
      assert.deepEqual(
        routeLayers(ROOT, APP, path.join(ROOT, measured.page)),
        [...measured.layers],
        `The layouts and templates above ${measured.page} changed. Add each new one to the render in ` +
          `${measured.test} (or record it there as read, not executed), re-measure, then update this list.`,
      );
    });
  }
});

describe("routeLayers", () => {
  it("lists layout and template files from the app directory down to the page, outermost first", () => {
    const root = mkdtempSync(path.join(tmpdir(), "route-layers-"));
    const page = path.join(root, "app", "(group)", "home");
    mkdirSync(page, { recursive: true });
    for (const file of ["app/layout.tsx", "app/(group)/template.tsx", "app/(group)/home/layout.ts", "app/(group)/home/page.tsx"]) {
      writeFileSync(path.join(root, file), "");
    }

    assert.deepEqual(routeLayers(root, path.join(root, "app"), page), [
      "app/layout.tsx", "app/(group)/template.tsx", "app/(group)/home/layout.ts",
    ]);
  });

  it("refuses a page outside the app directory", () => {
    assert.throws(() => routeLayers(ROOT, APP, path.join(ROOT, "src/lib")), /not inside/);
  });
});
