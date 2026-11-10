/**
 * The demo closeout's written procedure and the ignore rules beside it
 * (readiness H10).
 *
 * The repository is public and the closeout handles the production connection
 * string and a full export of student records. These tests pin the two places
 * a mistake would publish them: the commands DEPLOY.md tells the owner to type,
 * and what `git add -A` would pick up from the checkout.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

/** The text of a `##` or `###` section of DEPLOY.md, heading included, up to the next heading of that depth or shallower. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.replace(/^#+\s*/, "") === heading && line.startsWith("#"));
  assert.notEqual(start, -1, `DEPLOY.md has no heading "${heading}"`);
  const depth = lines[start].match(/^#+/)?.[0].length ?? 0;
  const length = lines.slice(start + 1).findIndex((line) => {
    const hashes = line.match(/^(#+)\s/)?.[1].length ?? 0;
    return hashes > 0 && hashes <= depth;
  });
  return lines.slice(start, length === -1 ? undefined : start + 1 + length).join("\n");
}

/** True when git would leave this path out of `git add -A`. */
function ignored(file: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--no-index", file], { cwd: ROOT });
  assert.ok(result.status === 0 || result.status === 1, `git check-ignore could not run for ${file}`);
  return result.status === 0;
}

describe("demo closeout ignore rules", () => {
  it("keeps a database export at the top of the checkout out of git", () => {
    for (const file of ["backup.sql", "visionquest.dump", "backups/2026-12-19.sql", "backups/anything.txt"]) {
      assert.equal(ignored(file), true, file);
    }
  });

  it("still tracks every Prisma migration and any other SQL below the top level", () => {
    for (const file of ["prisma/migrations/x/migration.sql", "prisma/migrations/20260101000000_x/migration.sql", "scripts/sql/report.sql", "docs/backups/note.md"]) {
      assert.equal(ignored(file), false, file);
    }
  });

  it("anchors the three rules at the root, with no rule that could match a migration", () => {
    const rules = read(".gitignore").split("\n").map((line) => line.trim());

    for (const rule of ["/*.sql", "/*.dump", "/backups/"]) assert.ok(rules.includes(rule), rule);
    assert.deepEqual(rules.filter((rule) => /^\*+\.sql$|^\*\*\/\*\.sql$/.test(rule)), []);
  });
});

describe("demo closeout backup commands in DEPLOY.md", () => {
  const backups = section(read("DEPLOY.md"), "Backups");

  it("never shows a connection string, or a name standing in for one, on a command line", () => {
    assert.doesNotMatch(backups, /"DIRECT_URL"|"DATABASE_URL"|"ADMIN_DATABASE_URL"/);
    assert.doesNotMatch(backups, /postgres(ql)?:\/\//);
    for (const command of backups.split("\n").filter((line) => /^\s*(pg_dump|psql|pg_restore)\b/.test(line))) {
      assert.match(command, /"\$ADMIN_DATABASE_URL"/, command);
    }
    assert.match(backups, /read -rs ADMIN_DATABASE_URL/);
  });

  it("writes the export outside the checkout, in a folder and a file only the owner can read", () => {
    assert.match(backups, /mkdir -p -m 700 "\$HOME\/VisionQuest-backups"/);
    assert.match(backups, /pg_dump .*--file="\$HOME\/VisionQuest-backups\//);
    assert.match(backups, /chmod 600 "\$HOME\/VisionQuest-backups\//);
    assert.doesNotMatch(backups, /> *backup\.sql|< *backup\.sql/);
  });

  it("says which connection pg_dump needs", () => {
    assert.match(backups, /6543/);
    assert.match(backups, /transaction pooler/i);
    assert.match(backups, /session|direct/i);
  });
});
