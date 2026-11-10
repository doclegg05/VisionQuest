import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEMO_ACCOUNT_KINDS } from "@/lib/demo/config";
import { DEMO_ENTRY_FAILED, DEMO_ENTRY_OFFLINE, DEMO_ENTRY_PENDING } from "@/lib/demo/copy";
import {
  announcementFor,
  continueTargetFor,
  entryButtonViewFor,
  entryOutcomeFor,
  offlineOutcome,
  parseEntryRefusal,
  parseEntrySuccess,
  parseSessionBody,
} from "./demo-entry";

/** What GET /api/auth/session answers for a live session. */
function sessionBody(overrides: Record<string, unknown>) {
  return {
    student: {
      id: "cl0000000000000000000000",
      studentId: "demo-0123456789ab",
      displayName: "Maya R.",
      role: "student",
      ...overrides,
    },
  };
}

describe("continueTargetFor", () => {
  it("links a demo student back to the dashboard", () => {
    assert.deepEqual(continueTargetFor(sessionBody({ demoAccount: "student" })), {
      label: "Continue as Maya R.",
      href: "/dashboard",
    });
  });

  it("links the demo instructor back to the teacher home", () => {
    const body = sessionBody({
      studentId: "demo-instructor",
      displayName: "Demo Instructor",
      role: "teacher",
      demoAccount: "instructor",
    });
    assert.deepEqual(continueTargetFor(body), {
      label: "Continue as Demo Instructor",
      href: "/teacher",
    });
  });

  it("trims the name it shows", () => {
    const target = continueTargetFor(sessionBody({ displayName: "  Maya R.  ", demoAccount: "student" }));
    assert.equal(target?.label, "Continue as Maya R.");
  });

  it("returns null for a real student, who has no demoAccount", () => {
    assert.equal(continueTargetFor(sessionBody({})), null);
    assert.equal(continueTargetFor(sessionBody({ demoAccount: null })), null);
  });

  it("returns null for a real teacher", () => {
    assert.equal(continueTargetFor(sessionBody({ role: "teacher" })), null);
  });

  it("returns null for the 401 body of a visitor with no session", () => {
    assert.equal(continueTargetFor({ error: "Unauthorized" }), null);
  });

  it("returns null for garbage", () => {
    const garbage: unknown[] = [
      null,
      undefined,
      "Continue as Maya",
      42,
      [],
      {},
      { student: null },
      { student: "Maya R." },
      sessionBody({ displayName: undefined, demoAccount: "student" }),
      sessionBody({ displayName: "", demoAccount: "student" }),
      sessionBody({ displayName: "   ", demoAccount: "student" }),
      sessionBody({ displayName: 7, demoAccount: "student" }),
      sessionBody({ demoAccount: "admin" }),
      sessionBody({ demoAccount: 1 }),
    ];
    for (const body of garbage) {
      assert.equal(continueTargetFor(body), null, `expected null for ${JSON.stringify(body)}`);
    }
  });
});

describe("entryOutcomeFor", () => {
  it("sends a student to the page the endpoint names", () => {
    const outcome = entryOutcomeFor(true, { redirectTo: "/dashboard", student: { displayName: "Maya R." } });
    assert.deepEqual(outcome, { kind: "enter", redirectTo: "/dashboard" });
  });

  it("sends the instructor to the page the endpoint names", () => {
    assert.deepEqual(entryOutcomeFor(true, { redirectTo: "/teacher" }), {
      kind: "enter",
      redirectTo: "/teacher",
    });
  });

  it("shows the endpoint's own message when it refuses", () => {
    const error = "The demo is full for today. Please try again tomorrow.";
    assert.deepEqual(entryOutcomeFor(false, { error }), { kind: "refused", message: error });
  });

  it("falls back to the retry message when a refusal has no usable error", () => {
    const refusedWithout: unknown[] = [null, undefined, "oops", 500, [], {}, { error: "" }, { error: "   " }, { error: 5 }];
    for (const body of refusedWithout) {
      assert.deepEqual(
        entryOutcomeFor(false, body),
        { kind: "refused", message: DEMO_ENTRY_FAILED },
        `expected the retry message for ${JSON.stringify(body)}`,
      );
    }
  });

  it("does not navigate on a success body that has no safe redirect", () => {
    const unsafe: unknown[] = [
      null,
      {},
      { redirectTo: "" },
      { redirectTo: 7 },
      { redirectTo: "dashboard" },
      { redirectTo: "//evil.example/dashboard" },
      { redirectTo: "/\\evil.example/dashboard" },
      { redirectTo: "https://evil.example/dashboard" },
      { redirectTo: "javascript:alert(1)" },
    ];
    for (const body of unsafe) {
      assert.deepEqual(
        entryOutcomeFor(true, body),
        { kind: "refused", message: DEMO_ENTRY_FAILED },
        `expected no navigation for ${JSON.stringify(body)}`,
      );
    }
  });

  it("does not navigate when a tab, line feed or carriage return hides a second slash", () => {
    // The WHATWG URL parser deletes tab, LF and CR before it reads the path, so
    // "/\t/evil.example" resolves to https://evil.example/ and router.push
    // would leave the site. A pattern that only looks at the second character
    // lets all three through.
    const hidden: unknown[] = [
      { redirectTo: "/\t/evil.example" },
      { redirectTo: "/\n/evil.example" },
      { redirectTo: "/\r/evil.example" },
      { redirectTo: "/\t\\evil.example" },
      { redirectTo: "/\r\n/evil.example" },
      { redirectTo: "/dashboard\t" },
      { redirectTo: "/dash\nboard" },
    ];
    for (const body of hidden) {
      assert.deepEqual(
        entryOutcomeFor(true, body),
        { kind: "refused", message: DEMO_ENTRY_FAILED },
        `expected no navigation for ${JSON.stringify(body)}`,
      );
    }
  });

  it("only follows the landing pages it knows, not any page on the site", () => {
    const elsewhere: unknown[] = [
      { redirectTo: "/settings" },
      { redirectTo: "/admin" },
      { redirectTo: "/dashboard/" },
      { redirectTo: "/dashboard?next=//evil.example" },
      { redirectTo: "/dashboard#top" },
      { redirectTo: " /dashboard" },
      { redirectTo: "/Dashboard" },
      { redirectTo: "/teacher/students" },
    ];
    for (const body of elsewhere) {
      assert.deepEqual(
        entryOutcomeFor(true, body),
        { kind: "refused", message: DEMO_ENTRY_FAILED },
        `expected no navigation for ${JSON.stringify(body)}`,
      );
    }
  });

  it("follows the landing page of every kind of demo account", () => {
    // The allowed pages and the Continue as links come from one record, so a new
    // kind of account cannot gain a link that the entry buttons would refuse.
    for (const kind of DEMO_ACCOUNT_KINDS) {
      const target = continueTargetFor(sessionBody({ demoAccount: kind }));
      assert.ok(target, `expected a Continue as link for ${kind}`);
      assert.deepEqual(entryOutcomeFor(true, { redirectTo: target.href }), {
        kind: "enter",
        redirectTo: target.href,
      });
    }
  });
});

describe("offlineOutcome", () => {
  it("tells the visitor to check their internet, which is not the unknown-reply message", () => {
    assert.deepEqual(offlineOutcome(), { kind: "refused", message: DEMO_ENTRY_OFFLINE });
    assert.equal(DEMO_ENTRY_OFFLINE, "We couldn't reach VisionQuest. Check your internet and try again.");
    assert.notEqual(DEMO_ENTRY_OFFLINE, DEMO_ENTRY_FAILED);
  });
});

describe("entryButtonViewFor", () => {
  const STUDENT = "/api/demo/student";
  const INSTRUCTOR = "/api/demo/instructor";

  it("leaves both buttons on their own labels and enabled when nothing is running", () => {
    assert.deepEqual(entryButtonViewFor(null, STUDENT, "Try as a student"), {
      label: "Try as a student",
      disabled: false,
    });
    assert.deepEqual(entryButtonViewFor(null, INSTRUCTOR, "Try as an instructor"), {
      label: "Try as an instructor",
      disabled: false,
    });
  });

  it("shows the pressed button as starting, and disables it", () => {
    assert.deepEqual(entryButtonViewFor(STUDENT, STUDENT, "Try as a student"), {
      label: DEMO_ENTRY_PENDING,
      disabled: true,
    });
  });

  it("keeps the other button on its own label but disabled", () => {
    assert.deepEqual(entryButtonViewFor(STUDENT, INSTRUCTOR, "Try as an instructor"), {
      label: "Try as an instructor",
      disabled: true,
    });
  });
});

describe("announcementFor", () => {
  it("announces the same words the pressed button shows, and nothing when idle", () => {
    assert.equal(announcementFor("/api/demo/student"), DEMO_ENTRY_PENDING);
    assert.equal(announcementFor("/api/demo/instructor"), DEMO_ENTRY_PENDING);
    assert.equal(announcementFor(null), "");
    assert.equal(DEMO_ENTRY_PENDING, "Starting the demo...");
  });
});

/**
 * The three guards replaced Zod schemas (G2, to keep Zod out of the sign-in
 * page's browser code). Each accepts what its schema accepted and refuses the rest.
 */
describe("parseSessionBody", () => {
  it("accepts every demoAccount the schema accepted: each kind, null and absent", () => {
    for (const kind of DEMO_ACCOUNT_KINDS) {
      assert.deepEqual(parseSessionBody(sessionBody({ demoAccount: kind })), {
        ok: true,
        value: { student: { displayName: "Maya R.", demoAccount: kind } },
      });
    }
    assert.deepEqual(parseSessionBody(sessionBody({ demoAccount: null })), {
      ok: true,
      value: { student: { displayName: "Maya R.", demoAccount: null } },
    });
    assert.deepEqual(parseSessionBody(sessionBody({})), {
      ok: true,
      value: { student: { displayName: "Maya R.", demoAccount: undefined } },
    });
  });

  it("trims the display name, as the schema's trim did", () => {
    const parsed = parseSessionBody({ student: { displayName: "\t Maya R. \n", demoAccount: "student" } });
    assert.deepEqual(parsed, { ok: true, value: { student: { displayName: "Maya R.", demoAccount: "student" } } });
  });

  it("refuses a body that is not an object holding a student object", () => {
    const bad: unknown[] = [null, undefined, 0, "x", true, [], [{ student: {} }], {}, { student: null }, { student: [] }, { student: "Maya" }];
    for (const body of bad) assert.deepEqual(parseSessionBody(body), { ok: false }, JSON.stringify(body));
  });

  it("refuses a missing, empty, blank or non-string display name", () => {
    for (const displayName of [undefined, null, "", "   ", 7, {}, ["Maya"]]) {
      assert.deepEqual(parseSessionBody({ student: { displayName } }), { ok: false }, JSON.stringify(displayName));
    }
  });

  it("refuses a demoAccount that is not a known kind", () => {
    for (const demoAccount of ["admin", "", "Student", 1, false, {}, ["student"]]) {
      assert.deepEqual(
        parseSessionBody({ student: { displayName: "Maya R.", demoAccount } }),
        { ok: false },
        JSON.stringify(demoAccount),
      );
    }
  });
});

describe("parseEntrySuccess", () => {
  it("accepts each landing page exactly, ignoring other fields", () => {
    for (const redirectTo of ["/dashboard", "/teacher"]) {
      assert.deepEqual(parseEntrySuccess({ redirectTo, student: { displayName: "Maya R." } }), {
        ok: true,
        value: { redirectTo },
      });
    }
  });

  it("refuses a body that is not an object", () => {
    for (const body of [null, undefined, "/dashboard", 1, [], ["/dashboard"]]) {
      assert.deepEqual(parseEntrySuccess(body), { ok: false }, JSON.stringify(body));
    }
  });

  it("refuses any redirectTo that is not exactly a landing page", () => {
    for (const redirectTo of [undefined, null, 7, "", "/dashboard ", " /teacher", "/Dashboard", "/dashboard/", "/settings", "//evil.example"]) {
      assert.deepEqual(parseEntrySuccess({ redirectTo }), { ok: false }, JSON.stringify(redirectTo));
    }
  });
});

describe("parseEntryRefusal", () => {
  it("accepts a non-blank error and trims it, as the schema did", () => {
    assert.deepEqual(parseEntryRefusal({ error: "  The demo is full.  " }), { ok: true, value: { error: "The demo is full." } });
  });

  it("refuses a body that is not an object, and a missing, blank or non-string error", () => {
    const bad: unknown[] = [null, undefined, "oops", 500, [], {}, { error: "" }, { error: " \n " }, { error: 5 }, { error: null }, { error: ["x"] }];
    for (const body of bad) assert.deepEqual(parseEntryRefusal(body), { ok: false }, JSON.stringify(body));
  });

  it("shows the trimmed refusal message to the visitor", () => {
    assert.deepEqual(entryOutcomeFor(false, { error: "  Try again tomorrow.  " }), {
      kind: "refused",
      message: "Try again tomorrow.",
    });
  });
});
