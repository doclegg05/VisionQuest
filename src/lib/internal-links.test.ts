import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every internal link in src must resolve to a real app route.
 *
 * Two shipped links went nowhere: the Monthly KPI "Intervention Queue" card
 * pointed at /teacher/students (only /teacher/students/[id] exists) and teacher
 * nudge notifications pointed at /teacher-dashboard. Both 404'd for teachers
 * (HIG review D-17, A-14, 2026-10-09).
 *
 * Covers href props and objects, router.push/replace, redirect(), and ternary
 * branches that start a line. A `${...}` right after a "/" counts as one
 * dynamic segment; anywhere else it is a query string and is ignored.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const APP = join(SRC, "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function routePattern(file: string): RegExp {
  const segments = relative(APP, file)
    .split("/")
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment));
  const body = segments
    .map((segment) =>
      segment.replace(/^\[\[?\.\.\.[^\]]+\]\]?$/, ".*").replace(/^\[[^\]]+\]$/, "[^/]+"),
    )
    .join("/");
  return new RegExp(`^/${body}/?$`);
}

const LINK =
  /(?:href\s*[:=]\s*\{?\s*|router\.(?:push|replace)\(\s*|redirect\(\s*|^\s*[?:]\s*)(["'`])(\/(?!\/)[^"'`?#$\s]*)(\$\{)?/g;
const NON_PAGE = /^\/api\/|\.(png|svg|pdf|jpe?g|ico|webp|mp4)$/;

const files = walk(SRC);
const routes = files.filter((f) => /[/\\](page|route)\.tsx?$/.test(f)).map(routePattern);

function unresolvedLinks(): string[] {
  return files
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f))
    .flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          [...line.matchAll(LINK)].flatMap((match) => {
            const raw = match[2];
            const dynamicSegment = Boolean(match[3]) && raw.endsWith("/");
            const path = (dynamicSegment ? `${raw}x` : raw).replace(/(.)\/$/, "$1");
            if (NON_PAGE.test(path) || routes.some((route) => route.test(path))) return [];
            return [`${relative(ROOT, file)}:${index + 1} ${raw}`];
          }),
        ),
    );
}

describe("internal links", () => {
  it("finds the app routes it checks against", () => {
    assert.ok(routes.length > 50, `expected the app's routes, found ${routes.length}`);
  });

  it("resolve to a real route", () => {
    assert.deepEqual(unresolvedLinks(), [], "these links point at routes that do not exist");
  });
});
