/**
 * Guards M1 and M6 against a layer they cannot see. Next.js renders every
 * `layout` and `template` file on the path down to a page, and each can read
 * the database. The dashboard and teacher-home measurements render the layers
 * listed below by hand; a new one above either page would run in production
 * and be missing from the count. This test fails when the set changes.
 *
 * `src/app/layout.tsx` is listed and not rendered: it reads only cookies and
 * headers, which the two measurement tests record as 0 "read, not executed".
 * That is checked, not trusted: the root layout test below fails if the
 * layout, or anything it imports through relative or `@/` paths, reaches the
 * database client.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { databaseImportChain, routeLayers } from "./route-layers";

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

describe("the root layout, which the measurements do not render", () => {
  it("reaches neither @/lib/db nor @prisma/client through its imports", () => {
    const chain = databaseImportChain(ROOT, "src/app/layout.tsx");
    assert.equal(
      chain,
      null,
      `src/app/layout.tsx reaches the database through ${chain?.join(" -> ")}. Render it in the M1 and M6 ` +
        "measurements, or count its queries there as read, not executed.",
    );
  });
});

describe("databaseImportChain", () => {
  function tree(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "db-imports-"));
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), source);
    }
    return root;
  }

  it("follows relative and @/ imports, index files included, to @/lib/db", () => {
    const root = tree({
      "src/app/layout.tsx": 'import { Nav } from "./nav";\nimport "server-only";',
      "src/app/nav.tsx": 'export { theme } from "@/lib/theme";',
      "src/lib/theme/index.ts": 'const load = () => import("../db");\nexport const theme = load;',
      "src/lib/db.ts": "export const prisma = {};",
    });

    assert.deepEqual(databaseImportChain(root, "src/app/layout.tsx"), [
      "src/app/layout.tsx", "src/app/nav.tsx", "src/lib/theme/index.ts", "src/lib/db.ts",
    ]);
  });

  it("finds @prisma/client, and passes a tree that reaches neither", () => {
    const reaches = tree({ "src/app/layout.tsx": 'import type { Prisma } from "@prisma/client";' });
    const clean = tree({
      "src/app/layout.tsx": 'import { cookies } from "next/headers";\nimport { a } from "./a";',
      "src/app/a.ts": 'import { b } from "./b";\nexport const a = b;',
      "src/app/b.ts": 'import { a } from "./a";\nexport const b = a;',
    });

    assert.deepEqual(databaseImportChain(reaches, "src/app/layout.tsx"), ["src/app/layout.tsx", "@prisma/client"]);
    assert.equal(databaseImportChain(clean, "src/app/layout.tsx"), null);
  });
});
