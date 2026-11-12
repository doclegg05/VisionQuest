import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Audit summaries are read by staff and admins and kept for years. They must
 * carry no student name, login username or email: the row's target id already
 * says who it is about (H15c item 2, H15 final review). This is a source-text
 * check, like the staff-read route walk, so a name cannot come back either.
 *
 * It reads the whole expression after every `summary:` under src/app/api and
 * src/lib, including both sides of a `cond ? `a` : `b`` choice, and flags an
 * interpolation that reads `displayName`, `firstName`, `lastName`, a
 * `.studentId` property (the login), or a bare `login`, `email` or `username`.
 * A bare `${studentId}` is the database id in these files and is allowed.
 */

const ROOTS = ["src/app/api", "src/lib"].map((root) => path.join(process.cwd(), root));
const NAME_FIELD = /\b(displayName|firstName|lastName)\b|\.studentId\b|(^|[^.\w])(login|email|username)\b/;
const INTERPOLATION = /\$\{([^}]*)\}/g;
const TEMPLATE = /`([^`]*)`/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    const isSource = /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/test-support/.test(entry);
    return isSource ? [full] : [];
  });
}

/** The value expression after `summary:`, up to the comma or brace that ends it. */
function summaryExpressions(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\bsummary:/g)) {
    let depth = 0;
    let inTemplate = false;
    let end = match.index + match[0].length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === "`") inTemplate = !inTemplate;
      if (inTemplate) continue;
      if ("([{".includes(char)) depth += 1;
      if (")]}".includes(char)) {
        if (depth === 0) break;
        depth -= 1;
      }
      if (char === "," && depth === 0) break;
    }
    found.push(source.slice(match.index + match[0].length, end));
  }
  return found;
}

export function namedInterpolations(source: string): string[] {
  const found: string[] = [];
  for (const expression of summaryExpressions(source)) {
    for (const template of expression.matchAll(TEMPLATE)) {
      for (const part of template[1].matchAll(INTERPOLATION)) {
        if (NAME_FIELD.test(part[1])) found.push(part[0]);
      }
    }
  }
  return found;
}

describe("audit summaries under src/app/api and src/lib", () => {
  it("the scanner flags names, the login and emails, and allows the database id", () => {
    const source = [
      "summary: `Updated record for ${record.firstName} ${record.lastName}.`,",
      "summary: `Marked ${enrollment.student.displayName} as active.`,",
      "summary: `Created student ${student.studentId}.`,",
      "summary: `Archived ${fileCount} files for ${studentId}.`,",
      "summary: clusterId ? `Set for ${student.studentId}.` : `Cleared for ${student.studentId}.`,",
      'summary: `Failed login attempt for "${login}"`,',
      "summary: `Invited ${email}.`,",
    ].join("\n");
    assert.deepEqual(namedInterpolations(source), [
      "${record.firstName}",
      "${record.lastName}",
      "${enrollment.student.displayName}",
      "${student.studentId}",
      "${student.studentId}",
      "${student.studentId}",
      "${login}",
      "${email}",
    ]);
  });

  it("no route or library writes a student name, login or email into an audit summary", () => {
    const offenders = ROOTS.flatMap((root) => sourceFiles(root)).flatMap((file) =>
      namedInterpolations(readFileSync(file, "utf8")).map(
        (hit) => `${path.relative(process.cwd(), file)}: ${hit}`,
      ),
    );
    assert.deepEqual(offenders, []);
  });
});
