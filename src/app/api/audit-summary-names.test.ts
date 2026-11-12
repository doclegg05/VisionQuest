import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Audit summaries are read by staff and admins and kept for years. They must
 * carry no student name and no login username: the row's target id already
 * says who it is about (H15c item 2). This is a source-text check, like the
 * staff-read route walk, so a name cannot come back in a new route either.
 *
 * It looks at every `summary:` template literal under src/app/api and flags
 * an interpolation that reads `displayName`, `firstName` or `lastName`, or a
 * `.studentId` property (the login). A bare `${studentId}` is the database
 * id in these routes and is allowed.
 */

const API_ROOT = path.join(process.cwd(), "src/app/api");
const NAME_FIELD = /\b(displayName|firstName|lastName)\b|\.studentId\b/;
const SUMMARY_TEMPLATE = /summary:\s*`([^`]*)`/g;
const INTERPOLATION = /\$\{([^}]*)\}/g;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    const isSource = /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry);
    return isSource ? [full] : [];
  });
}

export function namedInterpolations(source: string): string[] {
  const found: string[] = [];
  for (const summary of source.matchAll(SUMMARY_TEMPLATE)) {
    for (const part of summary[1].matchAll(INTERPOLATION)) {
      if (NAME_FIELD.test(part[1])) found.push(part[0]);
    }
  }
  return found;
}

describe("audit summaries under src/app/api", () => {
  it("the scanner flags names and the login, and allows the database id", () => {
    const source = [
      "summary: `Updated record for ${record.firstName} ${record.lastName}.`,",
      "summary: `Marked ${enrollment.student.displayName} as active.`,",
      "summary: `Created student ${student.studentId}.`,",
      "summary: `Archived ${fileCount} files for ${studentId}.`,",
    ].join("\n");
    assert.deepEqual(namedInterpolations(source), [
      "${record.firstName}",
      "${record.lastName}",
      "${enrollment.student.displayName}",
      "${student.studentId}",
    ]);
  });

  it("no route writes a student name or login into an audit summary", () => {
    const offenders = routeFiles(API_ROOT).flatMap((file) =>
      namedInterpolations(readFileSync(file, "utf8")).map(
        (hit) => `${path.relative(process.cwd(), file)}: ${hit}`,
      ),
    );
    assert.deepEqual(offenders, []);
  });
});
