import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The sign-in page is the first thing a student loads, often on a low-end
 * phone over a slow connection, so its browser code must not carry Zod. Three
 * small `safeParse` calls once pulled in the whole library (about 390 KB
 * before compression), because the bundler cannot tree-shake the `z` namespace.
 *
 * This test walks the import graph from the files that make up the sign-in
 * page (the root page, layout, loading, error and not-found files). A module
 * counts as browser code once the walk has passed through a `"use client"`
 * file: everything a client module imports ships to the browser, whatever
 * that module says about itself. Server-only modules reached only from server
 * modules are walked through but not checked.
 *
 * What it reads:
 * - Static `import ... from "x"`, `import "x"` and `export ... from "x"`.
 *   `import type` and `export type` lines are skipped, because TypeScript
 *   erases them and they never reach a bundle.
 * - A dynamic `import("x")` with a string literal is followed exactly like a
 *   static import. A lazily loaded chunk still downloads on this page, so it
 *   is not a way around the rule. An `import()` whose argument is not a string
 *   literal cannot be followed, so it fails the test rather than hide a module.
 * - It follows `@/` (to `src/`) and relative paths. Bare package specifiers are
 *   checked against the forbidden list but not walked into `node_modules`, so a
 *   third-party package that bundles Zod itself would not be caught here.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const APP = path.join(SRC, "app");
const ENTRY_FILES = ["page.tsx", "layout.tsx", "loading.tsx", "error.tsx", "not-found.tsx"];
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

/** A specifier is forbidden when it is one of these or a subpath of one. */
const FORBIDDEN = ["zod", "@/lib/schemas", "@/lib/zod-csp", "@hookform/resolvers"];

function isForbidden(specifier: string): boolean {
  return FORBIDDEN.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function isFile(candidate: string): boolean {
  return existsSync(candidate) && statSync(candidate).isFile();
}

/** The source file a local specifier names, or null for a package import. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  const found = candidates.find(isFile);
  if (!found) throw new Error(`Cannot resolve "${specifier}" from ${path.relative(ROOT, fromFile)}`);
  return found;
}

const STATIC_IMPORT = /^\s*(import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*([^)]*?)\s*\)/g;
const STRING_LITERAL = /^["'`]([^"'`$]+)["'`]$/;

interface ImportScan {
  specifiers: string[];
  unresolvable: string[];
}

function scanImports(source: string): ImportScan {
  const specifiers: string[] = [];
  const unresolvable: string[] = [];
  for (const match of source.matchAll(STATIC_IMPORT)) specifiers.push(match[2]);
  for (const match of source.matchAll(DYNAMIC_IMPORT)) {
    const literal = STRING_LITERAL.exec(match[1]);
    if (literal) specifiers.push(literal[1]);
    else unresolvable.push(`import(${match[1]})`);
  }
  return { specifiers, unresolvable };
}

function isClientModule(source: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(source);
}

interface Visit {
  file: string;
  client: boolean;
  trail: string[];
}

/** Every forbidden import reachable from browser code, each with the path that reaches it. */
function findForbiddenClientImports(entries: string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const queue: Visit[] = entries.map((file) => ({ file, client: false, trail: [] }));

  for (let visit = queue.shift(); visit; visit = queue.shift()) {
    const key = `${visit.client ? "client" : "server"}:${visit.file}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const source = readFileSync(visit.file, "utf8");
    const client = visit.client || isClientModule(source);
    const trail = [...visit.trail, path.relative(ROOT, visit.file)];
    const { specifiers, unresolvable } = scanImports(source);

    for (const expression of unresolvable) {
      problems.push(`${trail.join(" -> ")} has ${expression}, which this test cannot follow`);
    }
    for (const specifier of specifiers) {
      if (client && isForbidden(specifier)) problems.push(`${trail.join(" -> ")} -> "${specifier}"`);
      const next = resolveLocal(specifier, visit.file);
      if (next) queue.push({ file: next, client, trail });
    }
  }
  return problems;
}

describe("sign-in page browser code", () => {
  it("imports no Zod, no schemas module and no form resolvers", () => {
    const entries = ENTRY_FILES.map((name) => path.join(APP, name)).filter(isFile);
    assert.ok(entries.includes(path.join(APP, "page.tsx")), "expected src/app/page.tsx to exist");

    const problems = findForbiddenClientImports(entries);
    assert.deepEqual(problems, [], `Browser code on the sign-in page reaches:\n${problems.join("\n")}`);
  });

  it("recognizes a client module and a forbidden import", () => {
    assert.ok(isClientModule('"use client";\nimport x from "y";'));
    assert.ok(isClientModule("// note\n'use client';"));
    assert.ok(!isClientModule('import x from "y";\n"use client";'));
    assert.ok(isForbidden("zod") && isForbidden("zod/mini") && isForbidden("@/lib/zod-csp"));
    assert.ok(isForbidden("@hookform/resolvers/zod") && isForbidden("@/lib/schemas"));
    assert.ok(!isForbidden("zodiac") && !isForbidden("@/lib/schemas-extra"));
  });

  it("reads static, side-effect, re-export and literal dynamic imports, and skips type-only ones", () => {
    const source = [
      'import { a } from "./a";',
      'import "./side-effect";',
      'export { b } from "./b";',
      'import type { C } from "./c";',
      'export type { D } from "./d";',
      'import {\n  e,\n  f,\n} from "./ef";',
      'const g = () => import("./g");',
      "const h = (name: string) => import(name);",
    ].join("\n");
    assert.deepEqual(scanImports(source), {
      specifiers: ["./a", "./side-effect", "./b", "./ef", "./g"],
      unresolvable: ["import(name)"],
    });
  });
});
