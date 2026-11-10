import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DEMO_READ_ONLY_REFUSAL } from "@/lib/demo/copy";
import { PLAIN_LANGUAGE_IDEAL_GRADE, assessReadability } from "@/lib/sage/readability";
import { CLASS_NOT_SAVED, classRefusalMessage } from "./class-refusals";

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** What the screen says for a 400 with this server text, on the admin page unless told otherwise. */
function said(serverMessage: unknown, onAdminPage = true, status = 400): string {
  return classRefusalMessage({ status, serverMessage, onAdminPage });
}

const NOT_IN_REGION_ADMIN =
  "One of the instructors is not in this region. Add them to the region under Staff Waiting for a Region, then try again.";
const NOT_IN_REGION_ELSEWHERE =
  "One of the instructors is not in this region. Ask your program admin to add them to it, then try again.";
const NOT_IN_A_REGION = "You are not in a region yet. Ask your program admin to add you to a region.";
const PICK_A_REGION = "Pick a region for this class.";
const CODE_TAKEN = "That class code is already used. Type a different class code.";
const SESSION_ENDED = "Your session expired. Please sign in again.";
const NOT_ALLOWED = "You are not allowed to do this. Ask your program admin for help.";

/** Each refusal the two class routes send, in the server's words, and what the screen says. */
const KNOWN: ReadonlyArray<readonly [server: string, screen: string]> = [
  ["Pick at least one instructor.", "Pick at least one instructor."],
  ["Co-teachers must be in the same region.", NOT_IN_REGION_ADMIN],
  ["Pick a region for this classroom.", PICK_A_REGION],
  ["Pick a region for this class.", PICK_A_REGION],
  ["regionId must be a non-empty string or null.", PICK_A_REGION],
  ["That class code is already in use.", CODE_TAKEN],
  ["Class name is required.", "Type a name for the class."],
  ["Class name must be 120 characters or fewer.", "That class name is too long. Type a shorter name."],
  ["A class code is required.", "Type a class code. Use letters or numbers."],
  ["Class code is required.", "Type a class code. Use letters or numbers."],
  ["Enter a valid date.", "One of the dates is not a real date. Check the start date and the end date."],
  ["One or more selected instructors are invalid.", "One of the instructors can no longer be picked. Reload the page, then pick again."],
  ["Add yourself as an instructor of this classroom.", "Pick your own name too. You must be one of the instructors of this class."],
  ["Add yourself as an instructor of this class.", "Pick your own name too. You must be one of the instructors of this class."],
  [
    "Teachers can only be assigned to up to 2 active classes.",
    "One of the instructors already has 2 active classes. That is the most an instructor can have. Pick someone else.",
  ],
  ["That region does not exist.", "That region is no longer there. Pick another region."],
  ["Cannot assign a class to an archived region.", "That region is no longer in use. Pick another region."],
  ["Ask your regional coordinator to add you to a region before creating a classroom.", NOT_IN_A_REGION],
  ["Ask your regional coordinator to add you to a region before creating a class.", NOT_IN_A_REGION],
  ["You can put classrooms only in your own region.", "You can only put a class in a region you are in."],
  ["You can put classes only in your own region.", "You can only put a class in a region you are in."],
  ["Only an admin can move a classroom to another region.", "Only an admin can move a class to another region."],
  ["Only an admin can move a class to another region.", "Only an admin can move a class to another region."],
  ["Only an admin can remove a classroom from its region.", "Only an admin can take a class out of its region."],
  ["Only an admin can remove a class from its region.", "Only an admin can take a class out of its region."],
  ["You do not have access to this class.", "You cannot change this class. Ask your program admin for help."],
  ["Class not found.", "This class is no longer there. Reload the page."],
  [DEMO_READ_ONLY_REFUSAL, DEMO_READ_ONLY_REFUSAL],
];

/** Server text the screen cannot cause. A developer reads it; the screen says the default. */
const DEVELOPER_ONLY = new Set([
  "programType must be one of: spokes, adult_ed, ietp.",
  "Class status is invalid.",
  "Invalid JSON body.",
]);

describe("plain words for a class the server would not create or save", () => {
  for (const [server, screen] of KNOWN) {
    it(`says "${screen.slice(0, 48)}" for "${server.slice(0, 48)}"`, () => {
      assert.equal(said(server), screen);
    });
  }

  it("sends an instructor to their admin, not to a panel their page does not have", () => {
    assert.equal(said("Co-teachers must be in the same region.", false), NOT_IN_REGION_ELSEWHERE);
    assert.equal(NOT_IN_REGION_ELSEWHERE.includes("Staff Waiting for a Region"), false);
  });

  it("keeps the number the server gives for the most classes an instructor can have", () => {
    assert.match(said("Teachers can only be assigned to up to 3 active classes."), /already has 3 active classes\./);
  });

  it("knows a refusal whatever its capitals or the spaces around it", () => {
    assert.equal(said("  pick at least one instructor.  "), "Pick at least one instructor.");
    assert.equal(said("PICK A REGION FOR THIS CLASSROOM."), PICK_A_REGION);
  });

  it("says the default for text it does not know", () => {
    assert.equal(CLASS_NOT_SAVED, "The class was not saved. Try again. If it keeps happening, tell your program admin.");
    assert.equal(said("Something new the server started to say."), CLASS_NOT_SAVED);
    assert.equal(said("Internal server error: Unique constraint failed on the fields: (`code`)", true, 500), CLASS_NOT_SAVED);
  });

  it("never shows a sentence with a field name in it", () => {
    for (const text of ["regionId must be a non-empty string or null.", "programType must be one of: spokes, adult_ed, ietp.", "instructorIds.0 is not a cuid"]) {
      for (const status of [400, 403, 409, 500]) {
        assert.doesNotMatch(said(text, true, status), /regionId|programType|instructorIds/);
      }
    }
    assert.equal(said("programType must be one of: spokes, adult_ed, ietp."), CLASS_NOT_SAVED);
    assert.equal(said("instructorIds.0 is not a cuid"), CLASS_NOT_SAVED);
  });

  it("says the default when the answer had no readable text", () => {
    for (const nothing of [undefined, null, "", "   ", 42, { message: "Pick at least one instructor." }, ["Pick at least one instructor."]]) {
      assert.equal(said(nothing), CLASS_NOT_SAVED);
    }
  });
});

describe("plain words by status, for text it does not know", () => {
  const cases: ReadonlyArray<readonly [status: number, serverMessage: unknown, screen: string]> = [
    [400, "Bad request", CLASS_NOT_SAVED],
    [401, "Unauthorized", SESSION_ENDED],
    [403, "Forbidden", NOT_ALLOWED],
    [403, "Forbidden: origin mismatch.", NOT_ALLOWED],
    [404, undefined, CLASS_NOT_SAVED],
    [409, "limit", CODE_TAKEN],
    [500, "Internal server error", CLASS_NOT_SAVED],
    [503, "This feature is currently unavailable.", CLASS_NOT_SAVED],
  ];
  for (const [status, serverMessage, screen] of cases) {
    it(`${status} says "${screen.slice(0, 40)}"`, () => {
      assert.equal(said(serverMessage, true, status), screen);
    });
  }

  it("lets a known refusal win over its status", () => {
    assert.equal(said("Only an admin can move a classroom to another region.", true, 403), "Only an admin can move a class to another region.");
    assert.equal(said(DEMO_READ_ONLY_REFUSAL, false, 403), DEMO_READ_ONLY_REFUSAL);
  });
});

describe("the refusals the two class routes can send", () => {
  const routes = ["../../app/api/teacher/classes/route.ts", "../../app/api/teacher/classes/[id]/route.ts", "../../lib/class-create.ts"].map(sourceOf);
  const schemas = sourceOf("../../lib/schemas.ts");
  const classSchemas = schemas.slice(schemas.indexOf("// ─── Class Schemas"), schemas.indexOf("// ─── Auth Schemas"));
  const classroom = sourceOf("../../lib/classroom.ts");

  const thrown = routes.flatMap((source) => [...source.matchAll(/(?:badRequest|forbidden|conflict)\(\s*"([^"]+)"/g)].map((match) => match[1]));
  const answered = routes.flatMap((source) => [...source.matchAll(/\{ error: "([^"]+)" \}/g)].map((match) => match[1]));
  const fromSchemas = [...classSchemas.matchAll(/"([^"]+\.)"/g)].map((match) => match[1]);
  const limit = Number(classroom.match(/MAX_ACTIVE_CLASSES_PER_TEACHER = (\d+)/)?.[1]);
  const fromClassroom = [
    ...[...classroom.matchAll(/forbidden\("(You do not have access to this class\.)"\)/g)].map((match) => match[1]),
    `Teachers can only be assigned to up to ${limit} active classes.`,
  ];
  const sent = [...new Set([...thrown, ...answered, ...fromSchemas, ...fromClassroom])];

  it("finds them in the source", () => {
    assert.ok(thrown.length >= 12, `thrown: ${thrown.length}`);
    assert.ok(answered.includes("Class not found."));
    assert.ok(fromSchemas.includes("Pick at least one instructor."));
    assert.ok(classroom.includes("`Teachers can only be assigned to up to ${MAX_ACTIVE_CLASSES_PER_TEACHER} active classes.`"));
    assert.equal(fromClassroom.length, 2);
  });

  for (const server of sent) {
    it(`has its own words for: ${server.slice(0, 60)}`, () => {
      if (DEVELOPER_ONLY.has(server)) {
        assert.equal(said(server), CLASS_NOT_SAVED);
      } else {
        assert.notEqual(said(server), CLASS_NOT_SAVED, "a new refusal needs a sentence here, or a place in DEVELOPER_ONLY");
      }
    });
  }

  it("raises a conflict only for a class code that is taken, so a 409 can say so", () => {
    const conflicts = routes.flatMap((source) => [...source.matchAll(/conflict\(\s*"([^"]+)"/g)].map((match) => match[1]));
    assert.ok(conflicts.length >= 2);
    assert.deepEqual([...new Set(conflicts)], ["That class code is already in use."]);
  });
});

describe("the words the screen says", () => {
  const screens = [...new Set([...KNOWN.map(([, screen]) => screen), NOT_IN_REGION_ELSEWHERE, CLASS_NOT_SAVED, SESSION_ENDED, NOT_ALLOWED])];

  it("say class, never classroom", () => {
    for (const screen of screens) assert.doesNotMatch(screen, /classroom/i, screen);
  });

  it("use no dash characters and no field names", () => {
    for (const screen of screens) {
      assert.doesNotMatch(screen, /[–—]| - /, screen);
      assert.doesNotMatch(screen, /\b[a-z]+[A-Z][A-Za-z]*\b/, screen);
    }
  });

  // The same scorer and 12-word floor as scripts/ui-copy-readability.mjs, held
  // to the ideal grade because that script does not scan this folder.
  for (const screen of screens) {
    const result = assessReadability(screen, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    if (!result.scorable) continue;
    it(`reads at grade ${PLAIN_LANGUAGE_IDEAL_GRADE} or lower: "${screen.slice(0, 50)}"`, () => {
      assert.ok(result.grade <= PLAIN_LANGUAGE_IDEAL_GRADE, `grade ${result.grade}: ${screen}`);
    });
  }
});

// ClassRosterManager loads its data in an effect, so a static render stops at
// "Loading classes...". This reads its source for the wiring.
describe("the create and save handlers", () => {
  const manager = sourceOf("./ClassRosterManager.tsx");
  const create = manager.slice(manager.indexOf("async function createClass"), manager.indexOf("async function saveClassSettings"));
  const save = manager.slice(manager.indexOf("async function saveClassSettings"), manager.indexOf("async function updateClassStatus"));

  for (const [name, handler] of [["create", create], ["save", save]] as const) {
    it(`${name}: says a refusal in the screen's words, never the server's`, () => {
      assert.ok(handler.includes("fetch("), "the slice is the handler");
      const mapped = "classRefusalMessage({ status: response.status, serverMessage: payload?.error, onAdminPage: manageRegions })";
      assert.ok(handler.includes(`setError(${mapped});`));
      assert.equal(handler.split("payload?.error").length - 1, 1, "the server's text goes to the mapping and nowhere else");
    });

    it(`${name}: says the default when the request itself fails, not the browser's error text`, () => {
      assert.ok(handler.includes("setError(CLASS_NOT_SAVED)"));
      assert.equal(handler.includes("err.message"), false);
    });
  }
});
