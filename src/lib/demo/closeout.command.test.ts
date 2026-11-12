/**
 * The owner's closeout command, without the process around it (readiness H10).
 *
 * Everything the tool prints comes from `runCloseoutCommand`, so these tests
 * read the printed lines themselves: which database the run was on, what the
 * counts mean in plain sentences, what a failure says, and that no name,
 * login, email, id or connection string is ever among them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeoutClientOptions, runCloseoutCommand, type CommandResult } from "./closeout.command";
import { FAILURES, REFUSALS, targetLines } from "./closeout.report";
import { DEMO_CLASS_CODE, DEMO_INSTRUCTOR_LOGIN } from "./config";
import { LOCAL, scene, type FakeDb } from "./closeout.fixtures";

/** Built from parts so no scanner reads this file as holding a credential. It is not a real one. */
const PASSWORD = ["not", "a", "real", "password"].join("-");
const USER = "owner.projectref";
const URL = ["postgresql://", USER, ":", PASSWORD, "@db.example.test:5432/visionquest?sslmode=require"].join("");
const APPLY = ["--apply", "--confirm-demo-disabled", "--expect-accounts=2"];
const TARGET = [
  "Target: database closeout_fake on host db.example.test",
  "Project ref: not in the connection string.",
  "Server address: 10.0.0.7. This is the private address the server reports. It is not in the Supabase dashboard, so do not compare it.",
];

function command(db: FakeDb, argv: readonly string[], env: Readonly<Record<string, string>> = { ADMIN_DATABASE_URL: URL }) {
  const opened: string[] = [];
  const result = runCloseoutCommand(argv, env, { local: LOCAL, connect: (url) => { opened.push(url); return db.client(); } });
  return { opened, result };
}

const printed = (result: CommandResult): string => [...result.stdout, ...result.stderr].join("\n");

describe("demo closeout command", () => {
  it("previews by default: the target line, the counts as JSON, then sentences, and exit 0", async () => {
    const { db } = await scene();
    const before = db.snapshot();

    const { opened, result } = command(db, []);
    const { exitCode, stdout, stderr } = await result;

    assert.equal(exitCode, 0);
    assert.deepEqual(stderr, []);
    assert.deepEqual(stdout.slice(0, 3), TARGET);
    assert.equal(JSON.parse(stdout[3]).kind, "preview");
    assert.ok(stdout.length > 3);
    assert.deepEqual(opened, [URL]);
    assert.equal(db.snapshot(), before);
    assert.equal(db.disconnects, 1);
  });

  it("applies with the three arguments and exits 0", async () => {
    const { db } = await scene();

    const { exitCode, stdout, stderr } = await command(db, APPLY).result;

    assert.equal(exitCode, 0);
    assert.deepEqual(stderr, []);
    assert.deepEqual(stdout.slice(0, 3), TARGET);
    assert.equal(JSON.parse(stdout[3]).kind, "applied");
    assert.equal(db.rows("Student").filter((row) => row.demoAccount !== null).length, 0);
  });

  const REFUSED_ARGUMENTS: ReadonlyArray<readonly string[]> = [
    ["--apply"],
    ["--apply", "--confirm-demo-disabled"],
    ["--apply", "--expect-accounts=2"],
    ["--expect-accounts=2"],
    ["--force"],
    [...APPLY, "--skip-checks"],
    ["apply"],
    [URL],
    ["--apply", "--confirm-demo-disabled", "--expect-accounts=two"],
    ["--apply", "--confirm-demo-disabled", "--expect-accounts=-1"],
    ["--apply", "--confirm-demo-disabled", "--expect-accounts="],
    ["--apply", "--confirm-demo-disabled", "--expect-accounts=2.5"],
    ["--apply", "--confirm-demo-disabled", "--expect-accounts=2", "--expect-accounts=3"],
    ["--apply", "--confirm-demo-disabled", "--expect-accounts", "2"],
  ];
  for (const argv of REFUSED_ARGUMENTS) {
    it(`refuses the arguments ${JSON.stringify(argv).replace(URL, "<a database URL>")} with exit 2 and never connects`, async () => {
      const { db } = await scene();
      const before = db.snapshot();

      const { opened, result } = command(db, argv);
      const { exitCode, stdout, stderr } = await result;

      assert.equal(exitCode, 2);
      assert.deepEqual(stdout, []);
      assert.match(stderr.join("\n"), /^Refused: /);
      assert.equal(stderr.join("\n").includes(PASSWORD), false);
      assert.deepEqual(opened, []);
      assert.equal(db.transactions, 0);
      assert.equal(db.snapshot(), before);
    });
  }

  it("refuses with exit 2 when ADMIN_DATABASE_URL is missing", async () => {
    const { db } = await scene();

    const { opened, result } = command(db, [], {});

    assert.equal((await result).exitCode, 2);
    assert.deepEqual(opened, []);
  });

  it("refuses an apply while demo mode is on in this terminal, before it connects", async () => {
    const { db } = await scene();

    const { opened, result } = command(db, APPLY, { ADMIN_DATABASE_URL: URL, COHORT_DEMO_MODE: "true" });
    const { exitCode, stderr } = await result;

    assert.equal(exitCode, 2);
    assert.deepEqual(stderr, [`Refused: ${REFUSALS.demo_mode_on}`]);
    assert.deepEqual(opened, []);
  });

  it("exits 2 with the target, the fixed sentence and its count when the apply is refused", async () => {
    const { db, demo, real } = await scene();
    db.insert("StudentClassEnrollment", { classId: demo.classId, studentId: real.studentId });
    const before = db.snapshot();

    const { exitCode, stdout, stderr } = await command(db, APPLY).result;

    assert.equal(exitCode, 2);
    assert.deepEqual(stdout.slice(0, 3), TARGET);
    assert.deepEqual(stderr, [`Refused: ${REFUSALS.unmarked_student_in_demo_class} (count: 1)`]);
    assert.equal(db.snapshot(), before);
  });

  it("exits 2 for a preview too when no count can be trusted", async () => {
    const { db } = await scene();
    db.bypassesRls = false;

    const { exitCode, stdout, stderr } = await command(db, []).result;

    assert.equal(exitCode, 2);
    assert.deepEqual(stdout.slice(0, 3), TARGET);
    assert.equal(JSON.parse(stdout[3]).kind, "unreadable");
    assert.deepEqual(stderr, [`Refused: ${REFUSALS.cannot_see_every_row} (count: 1)`]);
  });

  it("tells a preview what an apply would refuse, and still exits 0", async () => {
    const { db, demo, real } = await scene();
    db.insert("StudentClassEnrollment", { classId: demo.classId, studentId: real.studentId });

    const { exitCode, stdout, stderr } = await command(db, []).result;

    assert.equal(exitCode, 0);
    assert.deepEqual(stderr, []);
    assert.ok(stdout.includes(`An apply would be refused: ${REFUSALS.unmarked_student_in_demo_class} (count: 1)`));
    assert.equal(stdout.some((line) => line.includes("--expect-accounts=")), false);
  });

  it("prints usage for --help and connects to nothing", async () => {
    const { db } = await scene();

    const { opened, result } = command(db, ["--help"]);
    const { exitCode, stdout } = await result;

    assert.equal(exitCode, 0);
    assert.match(stdout.join("\n"), /--apply --confirm-demo-disabled --expect-accounts=/);
    assert.match(stdout.join("\n"), /ADMIN_DATABASE_URL/);
    assert.deepEqual(opened, []);
  });

  it("opens the database client with no query log and short errors", () => {
    assert.deepEqual(closeoutClientOptions(URL), { datasources: { db: { url: URL } }, log: [], errorFormat: "minimal" });
  });
});

describe("demo closeout target lines", () => {
  const server = { database: "postgres", serverAddress: "10.0.47.12" };
  const REF = "abcdefghijklmnopqrst";
  const POOLER = "aws-0-us-east-1.pooler.supabase.com";
  const supabase = (password: string) => ["postgresql://postgres.", REF, ":", password, "@", POOLER, ":5432/postgres?sslmode=require"].join("");
  const ADDRESS_LINE = "Server address: 10.0.47.12. This is the private address the server reports. It is not in the Supabase dashboard, so do not compare it.";

  it("gives the host and the project ref from the connection string, and the server's address on its own line", () => {
    assert.deepEqual(targetLines(server, supabase(PASSWORD)), [
      `Target: database postgres on host ${POOLER}`,
      `Project ref: ${REF}`,
      ADDRESS_LINE,
    ]);
  });

  it("says when the connection string holds no project ref, and when the server reports no address", () => {
    assert.deepEqual(targetLines({ ...server, serverAddress: null }, URL), [
      "Target: database postgres on host db.example.test",
      "Project ref: not in the connection string.",
      "Server address: not reported.",
    ]);
  });

  it("does not trust the host in a connection string that overrides it with a host option", () => {
    const overridden = `${URL}&host=/var/run/postgresql`;

    assert.equal(targetLines(server, overridden)[0], "Target: database postgres on host unknown");
  });

  it("says unknown, and prints nothing else from it, for a connection string it cannot read", () => {
    for (const unreadable of ["", "not a url", "postgresql://"]) {
      assert.deepEqual(targetLines({ ...server, serverAddress: null }, unreadable).slice(0, 2), [
        "Target: database postgres on host unknown",
        "Project ref: not in the connection string.",
      ], unreadable);
    }
  });

  it("never prints any part of a password, whatever characters it holds", () => {
    const passwords = [
      "Zq9?Xw8", "Zq9#Xw8", "Zq9/Xw8", "Zq9@Xw8", "Zq9%40Xw8", "Zq9%3FXw8%23Vu7%2FTs6",
      "Zq9?Xw8#Vu7/Ts6@Rp5%40On4", "Zq9:Xw8", "Zq9@evil.example.test:5432/Xw8", "123/Zq9@Xw8", "Zq9?host=Xw8",
    ];
    for (const password of passwords) {
      const printed = targetLines(server, supabase(password)).join("\n");
      const pieces = password.split(/[^A-Za-z0-9]+/).filter((piece) => piece.length >= 3 && /\d/.test(piece));

      for (const piece of pieces) assert.equal(printed.includes(piece), false, `${password}: ${piece}`);
      assert.match(printed, new RegExp(`^Target: database postgres on host (${POOLER.replace(/\./g, "\\.")}|unknown)$`, "m"), password);
    }
  });

  it("finds the host and ref when the password is percent encoded, as Prisma needs it", () => {
    assert.deepEqual(targetLines(server, supabase("Zq9%3FXw8%40Vu7%2F")).slice(0, 2), [`Target: database postgres on host ${POOLER}`, `Project ref: ${REF}`]);
  });

  const DIRECT = `db.${REF}.supabase.co`;
  const direct = (password: string) => ["postgresql://postgres:", password, "@", DIRECT, ":5432/postgres"].join("");

  it("reads the project ref from a direct connection's host, as .env.example writes it", () => {
    assert.deepEqual(targetLines(server, direct(PASSWORD)).slice(0, 2), [`Target: database postgres on host ${DIRECT}`, `Project ref: ${REF}`]);
    assert.deepEqual(targetLines(server, direct("Zq9%3FXw8%40Vu7%2F%23Ts6%25")).slice(0, 2), [`Target: database postgres on host ${DIRECT}`, `Project ref: ${REF}`]);
  });

  it("reads no project ref from a host that only looks like a direct one", () => {
    for (const host of [`db.${REF}.supabase.co.evil.test`, `db.${REF}x.supabase.co`, `xdb.${REF}.supabase.co`, `db.${REF.toUpperCase()}.supabase.co`]) {
      assert.equal(targetLines(server, `postgresql://postgres:${PASSWORD}@${host}:5432/postgres`)[1], "Project ref: not in the connection string.", host);
    }
  });

  it("reads no project ref when the pooler user and the direct host name two projects", () => {
    const user = `postgresql://postgres.${"b".repeat(20)}:${PASSWORD}@${DIRECT}:5432/postgres`;

    assert.equal(targetLines(server, user)[1], "Project ref: not in the connection string.");
  });

  it("never prints any part of a direct connection's password, whatever characters it holds", () => {
    const passwords = ["Zq9?Xw8", "Zq9#Xw8", "Zq9/Xw8", "Zq9@Xw8", "Zq9%Xw8", "Zq9%40Xw8", "Zq9?Xw8#Vu7/Ts6@Rp5%On4", "Zq9@db.evil1.supabase.co:5432/Xw8"];
    for (const password of passwords) {
      const printed = targetLines(server, direct(password)).join("\n");
      const pieces = password.split(/[^A-Za-z0-9]+/).filter((piece) => piece.length >= 3 && /\d/.test(piece));

      for (const piece of pieces) assert.equal(printed.includes(piece), false, `${password}: ${piece}`);
      assert.match(printed, new RegExp(`^Target: database postgres on host (${DIRECT.replace(/\./g, "\\.")}|unknown)$`, "m"), password);
      assert.match(printed, new RegExp(`^Project ref: (${REF}|not in the connection string\\.)$`, "m"), password);
    }
  });

  it("says unknown when the standard parser cannot read the string and an @ could end the password in two places", () => {
    // The # makes the standard parser give up. Which @ ends the password is then a guess, so neither host is trusted.
    const ambiguous = `postgresql://postgres:Zq9#Xw8@${DIRECT}:5432/postgres?application_name=a@evil.example.test`;

    assert.deepEqual(targetLines(server, ambiguous).slice(0, 2), ["Target: database postgres on host unknown", "Project ref: not in the connection string."]);
  });

  it("never holds the user, the password, the query string or the path", () => {
    for (const address of ["10.0.47.12", null]) {
      const printed = targetLines({ ...server, serverAddress: address }, URL).join("\n");

      for (const secret of [USER, PASSWORD, "sslmode", "visionquest", "5432", "postgresql://"]) assert.equal(printed.includes(secret), false, secret);
    }
  });
});

describe("demo closeout sentences about what is left", () => {
  async function withUnmarked(students: number): Promise<FakeDb> {
    const { db } = await scene();
    for (let index = 1; index < students; index += 1) {
      db.insert("Student", { id: `rl-more-${index}`, studentId: `rl-more-${index}`, displayName: `rl- More ${index}`, role: "student", demoAccount: null });
    }
    return db;
  }
  const UNMARKED_STUDENTS = "37 student accounts have no demo mark. This tool does not delete them and cannot tell mock from real. If any are mock accounts they will look like real students. The database is not clean until you decide about each one.";

  it("says in a preview that unmarked student accounts are not known to be real", async () => {
    const db = await withUnmarked(37);

    const { stdout } = await command(db, []).result;

    assert.ok(stdout.includes(UNMARKED_STUDENTS), stdout.join("\n"));
  });

  it("says it again after an apply, where 0 marked could read as a clean database", async () => {
    const db = await withUnmarked(37);

    const { exitCode, stdout } = await command(db, APPLY).result;

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes(UNMARKED_STUDENTS), stdout.join("\n"));
    assert.ok(stdout.includes("Checked again after the closeout was saved: 0 accounts are marked as demo."));
  });

  it("says a second apply that finds 0 marked accounts did not make the database clean", async () => {
    const db = await withUnmarked(37);
    await command(db, APPLY).result;

    const { stdout } = await command(db, ["--apply", "--confirm-demo-disabled", "--expect-accounts=0"]).result;

    assert.ok(stdout.includes("No account is marked as demo. That is not the same as a clean database: read the next lines."));
    assert.ok(stdout.includes(UNMARKED_STUDENTS));
  });

  it("counts unmarked staff by role and says the tool cannot vouch for them", async () => {
    const { db } = await scene();
    db.insert("Student", { id: "rl-admin", studentId: "rl-admin", displayName: "rl- Admin", role: "admin", demoAccount: null });

    const { stdout } = await command(db, []).result;

    assert.ok(stdout.includes("2 staff accounts have no demo mark: 1 teacher, 1 admin, 0 coordinator, 0 with another role. This tool does not delete them and cannot tell mock from real. Decide about each one."), stdout.join("\n"));
  });

  it("warns about public credential pages that are switched on, and says nothing when none is", async () => {
    const { db } = await scene();
    const quiet = await command(db, []).result;
    db.insert("PublicCredentialPage", { studentId: "rl-staff", slug: "rl-open-page", isPublic: true });

    const { stdout } = await command(db, []).result;

    assert.equal(quiet.stdout.some((line) => line.includes("public credential page")), false);
    assert.ok(stdout.includes("1 public credential page of an account with no demo mark is switched on. Anyone who has its address can open it. This tool does not change it."), stdout.join("\n"));
  });

  it("says how many rows name an account or class that does not exist, column by column, and that the apply compares them", async () => {
    const { db } = await scene();
    const clean = await command(db, []).result;
    db.insert("AuditLog", { action: "x", targetType: "student", targetId: "gone-student" });
    db.insert("AuditLog", { action: "x", targetType: "student", targetId: "gone-too" });
    db.insert("SageMemory", { subjectType: "student", subjectId: "gone-student", content: "x", kind: "x", category: "x", sourceType: "x", sourceHash: "x" });

    const { stdout } = await command(db, []).result;

    assert.ok(clean.stdout.includes("0 rows name an account or class that does not exist."), clean.stdout.join("\n"));
    for (const line of [
      "3 rows name an account or class that does not exist. Some are expected, such as Sage records kept on purpose for students who left. Write down each number below. The apply counts them again after its deletes and refuses if any column is higher. The tool does not change these rows.",
      "Orphan rows in AuditLog.targetId: 2",
      "Orphan rows in SageMemory.subjectId: 1",
    ]) assert.ok(stdout.includes(line), `${line}\n---\n${stdout.join("\n")}`);
    assert.equal(stdout.some((line) => line.startsWith("Orphan rows in AuditLog.actorId")), false);
  });

  it("says after an apply, for each column with orphan rows, that it did not rise", async () => {
    const { db } = await scene();
    db.insert("AuditLog", { action: "x", targetType: "student", targetId: "gone-student" });

    const { exitCode, stdout } = await command(db, APPLY).result;

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("Orphan rows in AuditLog.targetId: 1 before the deletes, 1 after. Not higher."), stdout.join("\n"));
    assert.ok(stdout.includes("No column of orphan rows is higher after the deletes than before them."), stdout.join("\n"));
  });

  it("says what the tool leaves in settings, staff notices, listings and storage", async () => {
    const { db, demo, real } = await scene();
    db.insert("SystemConfig", { key: "pilot_classes", value: JSON.stringify([demo.classId]) });
    db.insert("Notification", { studentId: real.staffId, type: "x", title: "dm- student Name needs attention" });
    db.insert("Opportunity", { title: "x", company: "x", sourceJobLeadId: "dm-JobLead" });

    const { stdout } = await command(db, []).result;

    for (const line of [
      "1 program setting holds the id of the demo class. Remove the class from it in Program Setup, or ask a developer.",
      "1 notice to a staff member names a demo account. It stays in that staff member's list of notices.",
      "1 opportunity listing was copied from a demo class job lead. It stays.",
      "1 uploaded file in 1 storage folder belongs to the demo accounts. It may hold a real visitor's document. This tool does not remove files from storage, and removing them is a separate step that is not built yet.",
    ]) assert.ok(stdout.includes(line), `${line}\n---\n${stdout.join("\n")}`);
  });

  it("gives a preview with no refusal the number to pass to the apply", async () => {
    const { db } = await scene();

    const { stdout } = await command(db, []).result;

    assert.ok(stdout.includes("To apply, use --expect-accounts=2. That is the 1 marked student account plus the 1 marked instructor account."), stdout.join("\n"));
  });

  it("exits 3 and says so when a demo account was created while the closeout ran", async () => {
    const { db } = await scene();
    db.afterNextCommit = () => void db.insert("Student", { id: "dm-raced", studentId: "demo-raced", displayName: "dm- Raced", role: "student", demoAccount: "student" });

    const { exitCode, stdout, stderr } = await command(db, APPLY).result;

    assert.equal(exitCode, 3);
    assert.equal(JSON.parse(stdout[3]).kind, "applied");
    assert.deepEqual(stderr, ["Not finished: 1 demo account was created while the closeout ran, so demo mode is still on somewhere. It is still in the database. Check that demo mode is off in Render, wait 30 minutes, and start again from the preview."]);
  });

  it("exits 3 and asks for a preview when the check after the commit could not run", async () => {
    const { db } = await scene();
    db.afterNextCommit = () => { db.failOnCommit = new Error("connection closed"); };

    const { exitCode, stderr } = await command(db, APPLY).result;

    assert.equal(exitCode, 3);
    assert.deepEqual(stderr, ["Not checked: the closeout was saved, but the last check could not run. Run the preview again. If `marked` is 0, the closeout finished."]);
  });
});

describe("demo closeout failures", () => {
  const SECRET_ERROR = `Can't reach database server at ${URL} while reading dm- student Name`;

  it("exits 1 on an apply that fails, and does not claim to know what was deleted", async () => {
    const { db } = await scene();
    db.failOnDeleteOf = "Goal";
    db.failure = new Error(SECRET_ERROR);
    const before = db.snapshot();

    const { exitCode, stdout, stderr } = await command(db, APPLY).result;

    assert.equal(exitCode, 1);
    assert.deepEqual(stdout, TARGET);
    assert.deepEqual(stderr, ["The tool stopped. Run the preview again to see whether anything was deleted. If `marked` is 0, the closeout finished. If this keeps happening, stop and ask a developer. Do not change the database by hand."]);
    assert.equal(stderr[0], FAILURES.stopped);
    assert.equal(db.snapshot(), before);
    assert.equal(db.disconnects, 1);
  });

  it("says the same when the connection is lost during the commit and the rows are in fact gone", async () => {
    const { db } = await scene();
    db.failOnCommit = new Error(SECRET_ERROR);

    const { exitCode, stderr } = await command(db, APPLY).result;

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [FAILURES.stopped]);
    assert.equal(db.rows("Student").filter((row) => row.demoAccount !== null).length, 0);
    assert.doesNotMatch(FAILURES.stopped, /rolled back|nothing was deleted/i);
  });

  const CODED: ReadonlyArray<{ name: string; error: unknown; sentence: string }> = [
    { name: "a serialization failure (P2034)", error: { code: "P2034", message: SECRET_ERROR }, sentence: FAILURES.conflict },
    { name: "a serialization failure in a raw statement (P2010, 40001)", error: { code: "P2010", meta: { code: "40001", message: SECRET_ERROR } }, sentence: FAILURES.conflict },
    { name: "a deadlock in a raw statement (P2010, 40P01)", error: { code: "P2010", meta: { code: "40P01" } }, sentence: FAILURES.conflict },
    { name: "a transaction timeout (P2028)", error: { code: "P2028", message: SECRET_ERROR }, sentence: FAILURES.timeout },
    { name: "another raw statement error (P2010, 42P01)", error: { code: "P2010", meta: { code: "42P01" } }, sentence: FAILURES.stopped },
  ];
  for (const coded of CODED) {
    it(`gives ${coded.name} its own fixed sentence`, async () => {
      const { db } = await scene();
      db.failOnDeleteOf = "Goal";
      db.failure = coded.error;

      const { exitCode, stderr } = await command(db, APPLY).result;

      assert.equal(exitCode, 1);
      assert.deepEqual(stderr, [coded.sentence]);
    });
  }

  it("keeps the three failure sentences apart and free of dashes", () => {
    assert.equal(new Set(Object.values(FAILURES)).size, Object.values(FAILURES).length);
    assert.match(FAILURES.conflict, /Nothing was deleted\./);
    assert.match(FAILURES.timeout, /Run the preview again/);
    for (const sentence of Object.values(FAILURES)) assert.doesNotMatch(sentence, /[‒-―]| - /);
  });

  it("says a failed preview deleted nothing, because a preview only reads", async () => {
    const result = await runCloseoutCommand([], { ADMIN_DATABASE_URL: URL }, {
      local: LOCAL,
      connect: () => ({ $disconnect: async () => undefined, $transaction: async () => { throw new Error(SECRET_ERROR); } }),
    });

    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.stdout, []);
    assert.deepEqual(result.stderr, [FAILURES.previewStopped]);
    assert.match(FAILURES.previewStopped, /deleted nothing/);
  });

  it("never prints any part of an error, or the connection string, when connecting throws", async () => {
    const result = await runCloseoutCommand([], { ADMIN_DATABASE_URL: URL }, { local: LOCAL, connect: () => { throw new Error(SECRET_ERROR); } });

    assert.equal(result.exitCode, 1);
    for (const secret of [PASSWORD, USER, "db.example.test", "dm-"]) assert.equal(printed(result).includes(secret), false, secret);
  });

  it("notes a connection that did not close, without losing the result", async () => {
    const { db } = await scene();
    const client = db.client();
    const result = await runCloseoutCommand([], { ADMIN_DATABASE_URL: URL }, {
      local: LOCAL,
      connect: () => ({ $transaction: client.$transaction, $disconnect: async () => { throw new Error(SECRET_ERROR); } }),
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stderr, ["Note: the database connection did not close cleanly."]);
  });
});

describe("demo closeout command prints counts, the database name and the host only", () => {
  /** Leaves of the printed JSON that are allowed to be text. Every other leaf must be a number or true/false. */
  const TEXT_LEAF = /^\.kind$|^\.target\.(database|serverAddress)$|^\.refusals\.\d+\.(code|sentence)$/;

  function textLeaves(value: unknown, path = ""): string[] {
    if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([name, child]) => textLeaves(child, `${path}.${name}`));
    return typeof value === "number" || typeof value === "boolean" || value === null || TEXT_LEAF.test(path) ? [] : [path];
  }

  async function staged(): Promise<FakeDb> {
    const { db } = await scene();
    db.insert("Student", {
      id: "cm3x9k2p40000qwertyuiopas", studentId: "maria.gonzalez", displayName: "Maria Gonzalez",
      email: "maria.gonzalez@example.org", role: "student", demoAccount: null,
    });
    return db;
  }

  function assertNoLeak(db: FakeDb, seeded: readonly string[], result: CommandResult): void {
    const text = printed(result);
    assert.ok(seeded.length > 100);
    assert.deepEqual(seeded.filter((value) => text.includes(value)), []);
    assert.doesNotMatch(text, /@|maria|gonzalez/i);
    assert.doesNotMatch(text, /\bc[a-z0-9]{24}\b/);
    for (const secret of [DEMO_INSTRUCTOR_LOGIN, DEMO_CLASS_CODE, PASSWORD, USER, "postgresql://", "sslmode"]) assert.equal(text.includes(secret), false, secret);
    assert.deepEqual(textLeaves(JSON.parse(result.stdout[3])), []);
    assert.ok(db.disconnects >= 1);
  }

  const seededStrings = (db: FakeDb): string[] => db.allStrings().filter((value) => /^(dm-|rl-)|@|maria|gonzalez/i.test(value));

  it("in a preview", async () => {
    const db = await staged();
    const seeded = seededStrings(db);

    const result = await command(db, []).result;

    assert.equal(JSON.parse(result.stdout[3]).kind, "preview");
    assertNoLeak(db, seeded, result);
  });

  it("in a refused apply, with every refusal the scene can raise at once", async () => {
    const db = await staged();
    db.insert("StudentClassEnrollment", { classId: "dm-class", studentId: "rl-student" });
    db.insert("SpokesClassInstructor", { classId: "rl-class", instructorId: "dm-staff" });
    db.createLockHeld = true;
    const seeded = seededStrings(db);

    const result = await command(db, ["--apply", "--confirm-demo-disabled", "--expect-accounts=9"]).result;

    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.length >= 4, result.stderr.join("\n"));
    assertNoLeak(db, seeded, result);
  });

  it("in an apply", async () => {
    const db = await staged();
    const seeded = seededStrings(db);

    const result = await command(db, APPLY).result;

    assert.equal(JSON.parse(result.stdout[3]).kind, "applied");
    assertNoLeak(db, seeded, result);
  });

  it("in an apply that fails half way", async () => {
    const db = await staged();
    const seeded = seededStrings(db);
    db.failOnDeleteOf = "Goal";
    db.failure = new Error(`dm-student could not be deleted: ${URL}`);

    const result = await command(db, APPLY).result;

    assert.equal(result.exitCode, 1);
    assert.deepEqual(seeded.filter((value) => printed(result).includes(value)), []);
    assert.equal(printed(result).includes(PASSWORD), false);
  });
});
