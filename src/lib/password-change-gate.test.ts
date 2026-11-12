import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED,
  PASSWORD_CHANGE_PATH,
  PUBLIC_FILES,
  isAllowedWhilePasswordChangeRequired,
  passwordChangeRequired,
} from "./password-change-gate";

// ---------------------------------------------------------------------------
// What a session that must change its password may still reach.
//
// src/proxy.ts asks this file about every request from such a session. The
// rule is default-deny and matches whole paths, so a route added tomorrow is
// refused until someone lists it here. The walks below hold the list to the
// source tree: every entry names something that exists, and every entry but
// the change route and the session route is one a signed-out visitor could
// reach anyway.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "src/app/api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** The session wrappers and the direct read: a route that names one acts on a signed-in person. */
const READS_THE_SESSION = /\b(?:getSession|withAuth|withTeacherAuth|withAdminAuth|withCoordinatorAuth|withRegistry)\(/u;

/** The two entries that need the session: the way out of the gate, and reading or ending the session. */
const NEEDS_THE_SESSION = new Set(["POST /api/settings/password", "GET /api/auth/session", "DELETE /api/auth/session"]);

function exportedMethods(source: string): string[] {
  const exported = new Set<string>();
  for (const match of source.matchAll(/^export\s+(?:async\s+function|function|const)\s+([A-Z]+)\b/gmu)) {
    exported.add(match[1] ?? "");
  }
  return METHODS.filter((method) => exported.has(method));
}

/** "METHOD /api/path" → the route file's source, for every handler under src/app/api. */
function apiHandlers(): Map<string, string> {
  const handlers = new Map<string, string>();
  const files = readdirSync(API_DIR, { recursive: true, encoding: "utf8" }).filter(
    (file) => path.basename(file) === "route.ts",
  );
  for (const file of files) {
    const source = readFileSync(path.join(API_DIR, file), "utf8");
    const urlPath = ["/api", ...path.dirname(file).split(path.sep).filter((segment) => segment !== ".")].join("/");
    for (const method of exportedMethods(source)) handlers.set(`${method} ${urlPath}`, source);
  }
  return handlers;
}

function allowed(entry: string): boolean {
  const [method = "", pathname = ""] = entry.split(" ");
  return isAllowedWhilePasswordChangeRequired(method, pathname);
}

describe("what stays reachable while a password change is required", () => {
  const handlers = apiHandlers();
  const apiEntries = ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED.filter((entry) => entry.includes(" /api/"));
  const pageEntries = ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED.filter((entry) => !entry.includes(" /api/"));

  it("walks the app's API handlers", () => {
    assert.ok(handlers.size > 200, `expected the app's API handlers, found ${handlers.size}`);
  });

  it("allows every entry on the list", () => {
    for (const entry of ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED) assert.equal(allowed(entry), true, entry);
  });

  it("allows the change screen, the change route, and reading or ending the session", () => {
    for (const entry of [`GET ${PASSWORD_CHANGE_PATH}`, ...NEEDS_THE_SESSION]) assert.equal(allowed(entry), true, entry);
  });

  it("refuses every API handler that is not on the list", () => {
    const listed = new Set(ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED);
    const refused = [...handlers.keys()].filter((key) => !listed.has(key));

    assert.ok(refused.length > 200, `expected nearly every handler to be refused, found ${refused.length}`);
    for (const key of refused) assert.equal(allowed(key), false, key);
  });

  it("names only API handlers that exist", () => {
    for (const entry of apiEntries) assert.ok(handlers.has(entry), `${entry} is listed but no route file exports it`);
  });

  it("lists no API route that reads the session, apart from the change route and the session route", () => {
    for (const entry of apiEntries.filter((item) => !NEEDS_THE_SESSION.has(item))) {
      assert.equal(READS_THE_SESSION.test(handlers.get(entry) ?? ""), false, `${entry} reads the session`);
    }
  });

  it("names only pages that exist outside every route group", () => {
    assert.ok(pageEntries.length > 0);
    for (const entry of pageEntries) {
      const [method, pathname = ""] = entry.split(" ");
      assert.equal(method, "GET", `${entry}: a page is listed for GET only`);
      assert.ok(existsSync(path.join(ROOT, "src/app", pathname, "page.tsx")), `${entry} has no page.tsx`);
    }
  });

  it("matches the whole path and the method, never a prefix or a neighbour", () => {
    for (const [method, pathname] of [
      ["GET", "/api/settings/password"],
      ["PUT", "/api/settings/password"],
      ["POST", "/api/settings/password/"],
      ["POST", "/api/settings/password/extra"],
      ["POST", "/api/settings/passwords"],
      ["POST", "/api/settings/profile"],
      ["POST", "/api/auth/session"],
      ["PATCH", "/api/auth/session"],
      ["GET", "/api/auth/session/extra"],
      ["POST", "/change-password"],
      ["GET", "/change-password/extra"],
      ["GET", "/change-passwordx"],
      ["GET", "/dashboard"],
      ["GET", "/settings"],
      ["GET", "/recovery-setup"],
      ["GET", "/api/goals"],
      ["POST", "/api/chat/send"],
      ["GET", "/api/files/spokes-logo.png"],
      ["GET", "/API/auth/session"],
      ["GET", "//api/auth/session"],
      ["GET", ""],
    ] as const) {
      assert.equal(isAllowedWhilePasswordChangeRequired(method, pathname), false, `${method} ${pathname}`);
    }
  });

  it("holds HEAD to the GET list, and reads the method in any case", () => {
    assert.equal(isAllowedWhilePasswordChangeRequired("HEAD", PASSWORD_CHANGE_PATH), true);
    assert.equal(isAllowedWhilePasswordChangeRequired("head", "/api/auth/session"), true);
    assert.equal(isAllowedWhilePasswordChangeRequired("get", PASSWORD_CHANGE_PATH), true);
    assert.equal(isAllowedWhilePasswordChangeRequired("HEAD", "/api/settings/password"), false);
    assert.equal(isAllowedWhilePasswordChangeRequired("OPTIONS", "/api/goals"), false);
  });
});

describe("static files while a password change is required", () => {
  const onDisk = readdirSync(path.join(ROOT, "public"), { recursive: true, encoding: "utf8", withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `/${path.relative(path.join(ROOT, "public"), path.join(entry.parentPath, entry.name)).split(path.sep).join("/")}`)
    .sort();

  it("lists exactly the files in public/", () => {
    assert.ok(onDisk.length > 0);
    assert.deepEqual([...PUBLIC_FILES].sort(), onDisk);
  });

  it("serves each of them to GET and HEAD, and to nothing else", () => {
    for (const file of onDisk) {
      assert.equal(isAllowedWhilePasswordChangeRequired("GET", file), true, file);
      assert.equal(isAllowedWhilePasswordChangeRequired("HEAD", file), true, file);
      assert.equal(isAllowedWhilePasswordChangeRequired("POST", file), false, file);
    }
  });

  it("does not pass a path because it ends like a file", () => {
    for (const pathname of ["/dashboard.png", "/goals/abc.svg", "/teacher/hostile.jpg", "/spokes-logo.png/extra", "/media", "/images/other.png"]) {
      assert.equal(isAllowedWhilePasswordChangeRequired("GET", pathname), false, pathname);
    }
  });
});

describe("which accounts must change a password", () => {
  const flagged = { mustChangePassword: true, role: "student", passwordHash: "scrypt$salt$hash", demoAccount: null };

  it("is true for a student whose password somebody else set", () => {
    assert.equal(passwordChangeRequired(flagged), true);
  });

  it("is false once the flag is clear", () => {
    assert.equal(passwordChangeRequired({ ...flagged, mustChangePassword: false }), false);
  });

  it("is false for an account with no password yet: there is nothing anyone else knows", () => {
    assert.equal(passwordChangeRequired({ ...flagged, passwordHash: null }), false);
  });

  it("is false for staff, who are never given a password by someone else", () => {
    for (const role of ["teacher", "admin", "coordinator", "program_coordinator", "cdc"]) {
      assert.equal(passwordChangeRequired({ ...flagged, role }), false, role);
    }
  });

  it("is false for a demo account, which has no password to change", () => {
    for (const demoAccount of ["student", "instructor"]) {
      assert.equal(passwordChangeRequired({ ...flagged, demoAccount }), false, demoAccount);
    }
  });
});
