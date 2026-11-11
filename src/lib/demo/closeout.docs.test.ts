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
import { RECENT_MINUTES } from "./closeout.guards";

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
    assert.match(backups, /read -rs ADMIN_DATABASE_URL/);
  });

  it("keeps the password off the command line: pg_dump and psql get a URL without it, and the password goes in PGPASSWORD", () => {
    const commands = backups.split("\n").filter((line) => /^\s*(pg_dump|psql|pg_restore)\b/.test(line));
    assert.ok(commands.length >= 2, `${commands.length} commands`);
    for (const command of commands) {
      assert.match(command, /"\$URL_WITHOUT_PASSWORD"/, command);
      assert.doesNotMatch(command, /ADMIN_DATABASE_URL|PGPASSWORD/, command);
    }
    assert.match(backups, /export PGPASSWORD="\$\(node -e '[^']*process\.env\.ADMIN_DATABASE_URL[^']*\.password[^']*'\)"/);
    assert.match(backups, /export URL_WITHOUT_PASSWORD="\$\(node -e '[^']*process\.env\.ADMIN_DATABASE_URL[^']*password = ""[^']*'\)"/);
    assert.match(backups, /unset PGPASSWORD/);
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

describe("demo closeout procedure in DEPLOY.md", () => {
  const steps = section(read("DEPLOY.md"), "Turn it off after Dec 18, 2026");
  const numbered = steps.split("\n").filter((line) => /^\d+\. /.test(line));
  /** The text of numbered step `n`, up to the next numbered step. */
  const step = (n: number): string => {
    const lines = steps.split("\n");
    const start = lines.findIndex((line) => line.startsWith(`${n}. `));
    const end = lines.findIndex((line, index) => index > start && line.startsWith(`${n + 1}. `));
    assert.notEqual(start, -1, `no step ${n}`);
    return lines.slice(start, end === -1 ? undefined : end).join("\n");
  };
  const stepWith = (text: string): number => numbered.findIndex((line) => line.includes(text)) + 1;

  it("starts from an up to date main checkout in a terminal window used only for this", () => {
    for (const command of ["git switch main", "git pull", "npm ci", "npx prisma generate"]) assert.ok(step(1).includes(command), command);
    assert.match(steps, /new terminal window/i);
  });

  it("reads the connection string without showing it, clears the clipboard and names where the secret lives", () => {
    assert.match(steps, /read -rs ADMIN_DATABASE_URL/);
    assert.match(steps, /pbcopy < \/dev\/null/);
    assert.match(steps, /Render dashboard, service `visionquest`, \*\*Environment\*\* tab, key `ADMIN_DATABASE_URL`/);
    assert.doesNotMatch(steps, /postgres(ql)?:\/\//);
  });

  it("keeps AI_LOCAL_ONLY in the step that deletes the demo variables, and sets REAL_STUDENT_DATA only after the apply", () => {
    const off = stepWith("delete `COHORT_DEMO_MODE`");
    assert.ok(off > 0);
    assert.match(step(off), /AI_LOCAL_ONLY/);
    const apply = stepWith("Run the apply");
    const real = stepWith("Set `REAL_STUDENT_DATA`");
    assert.ok(apply > off && real > apply, `steps: off ${off}, apply ${apply}, real ${real}`);
  });

  it("waits as long after the deploy as the tool's own recent activity window, confirms the backup right before the apply, and previews again the next day", () => {
    const wait = stepWith("Wait ");
    assert.match(numbered[wait - 1], new RegExp(`^${wait}\\. \\*\\*Wait ${RECENT_MINUTES} minutes after the deploy shows Live`));
    assert.doesNotMatch(steps, /15 minutes/);
    const backup = stepWith("Make or confirm the backup");
    assert.equal(backup + 1, stepWith("Run the apply"));
    assert.match(step(backup), /every change made after/i);
    assert.match(steps, /next day/i);
    assert.match(steps, /--expect-accounts=/);
  });

  it("says a count of unmarked accounts above 0 may be mock accounts, and gives a success test that needs both numbers", () => {
    assert.doesNotMatch(steps, /`unmarked` is the people it leaves alone/);
    assert.match(steps, /above 0 means mock accounts may still be in the database/);
    assert.match(steps, /`marked` is 0 and `unmarked\.students` is the number you expect/);
  });

  it("makes a fresh export the default backup, and counts a dashboard backup only with point in time recovery", () => {
    const backup = step(stepWith("Make or confirm the backup"));
    assert.match(backup, /\[Backups\]\(#backups\)/);
    assert.match(backup, /point in time recovery is on/);
    assert.doesNotMatch(backup, /a backup from today exists/);
    assert.doesNotMatch(backup, /today's backup in the list/);
  });

  it("says which printed value to compare with which Supabase dashboard field, and not to compare the server address", () => {
    const preview = step(stepWith("Run the preview and read it"));
    assert.match(preview, /`Project ref:`.*Project ID.*Project Settings, General/);
    assert.match(preview, /`Target: database \.\.\. on host \.\.\.`.*host.*Connect/);
    assert.match(preview, /`Server address:`.*do not compare it/i);
    assert.doesNotMatch(preview, /The host must be the production database host shown in the Supabase dashboard, Project Settings, Database/);
  });

  it("asks for each orphan column in the preview, says the apply refuses if one rises, and does not ask for 0 orphans afterwards", () => {
    const preview = step(stepWith("Run the preview and read it"));
    assert.match(preview, /`leftBehind\.orphans`/);
    assert.match(preview, /each column/i);
    assert.match(preview, /refuses if any column is higher/);
    const again = step(stepWith("Run the preview again"));
    assert.doesNotMatch(again, /0 rows name an account or class that does not exist/);
    assert.doesNotMatch(again, /orphan total is above 0/);
    assert.match(again, /`marked` is 0/);
  });

  it("never says a stopped run rolled back, and gives the sentence the tool prints instead", () => {
    assert.doesNotMatch(steps, /Exit code 1 means it failed, the transaction was rolled back/);
    assert.match(steps, /Run the preview again to see whether anything was deleted/);
  });

  it("says the uploaded files stay in storage and that removing them is not built yet", () => {
    assert.match(steps, /real visitors' documents/);
    assert.match(steps, /not built yet/);
  });

  it("gives every step what success looks like, ends by closing the terminal, and uses no dash characters", () => {
    assert.ok(numbered.length >= 10, `${numbered.length} steps`);
    for (let n = 1; n <= numbered.length; n += 1) assert.match(step(n), /Success|success/, `step ${n}`);
    assert.match(step(numbered.length), /[Cc]lose the terminal/);
    assert.doesNotMatch(steps, /[‒-―]| -- | - /);
  });

  it("lists REAL_STUDENT_DATA in the environment table", () => {
    assert.match(read("DEPLOY.md"), /^\| `REAL_STUDENT_DATA` \|/m);
  });
});
