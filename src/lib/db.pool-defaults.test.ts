import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

/**
 * The pool bound is string surgery on env vars nothing re-reads, so a mistake
 * here is invisible until the database runs out of connections under load.
 *
 * Why ADMIN_DATABASE_URL needed one: Prisma reads a missing `connection_limit`
 * as "open as many as you like", and the nudge runner's run lock now parks ONE
 * admin connection for the length of a sweep. An unbounded admin pool beside a
 * long-lived checkout is how the instance runs out of connections and the app
 * pool students are waiting on starts failing.
 *
 * The env vars are set BEFORE db.ts is imported, because `applyPoolDefaults()`
 * runs once at module load — importing first and setting them after would test
 * nothing. node:test gives each file its own process, so this is contained.
 */

const APP_URL = "postgresql://vq_app:pw@db.example.test:5432/postgres?schema=visionquest";
const ADMIN_URL = "postgresql://postgres:pw@db.example.test:5432/postgres?schema=visionquest";

process.env.DATABASE_URL = APP_URL;
process.env.ADMIN_DATABASE_URL = ADMIN_URL;

let withPoolDefaults: typeof import("./db").withPoolDefaults;

before(async () => {
  ({ withPoolDefaults } = await import("./db"));
});

const BASE = "postgresql://user:pw@db.example.test:5432/postgres";

describe("withPoolDefaults", () => {
  it("adds a bound to a URL that has no query string", () => {
    assert.equal(withPoolDefaults(BASE, 10, 10), `${BASE}?connection_limit=10&pool_timeout=10`);
  });

  it("appends to a URL that already has other params", () => {
    const url = `${BASE}?schema=visionquest`;
    assert.equal(
      withPoolDefaults(url, 10, 10),
      `${url}&connection_limit=10&pool_timeout=10`,
      "the separator must be & once a ? is present, or the URL is malformed",
    );
  });

  it("leaves an explicit connection_limit completely alone", () => {
    // Including pool_timeout: an operator who set one half meant it, and
    // adding the other half is a second, different opinion on their setup.
    const url = `${BASE}?connection_limit=3`;
    assert.equal(withPoolDefaults(url, 10, 10), url);
  });

  it("leaves an explicit pool_timeout alone too", () => {
    const url = `${BASE}?pool_timeout=30`;
    assert.equal(withPoolDefaults(url, 10, 10), url);
  });

  it("returns an empty URL untouched rather than inventing one", () => {
    assert.equal(withPoolDefaults("", 10, 10), "");
  });

  it("is idempotent, so a second pass cannot double the params", () => {
    const once = withPoolDefaults(BASE, 10, 10);
    assert.equal(withPoolDefaults(once, 10, 10), once);
  });
});

describe("what module load actually did to the env", () => {
  it("bounded the ADMIN pool, which had no bound at all before", () => {
    const url = process.env.ADMIN_DATABASE_URL ?? "";
    assert.ok(url.startsWith(ADMIN_URL), "the original URL must survive intact");
    assert.match(url, /connection_limit=10/);
    assert.match(url, /pool_timeout=10/);
  });

  it("still bounds the app pool, at its own smaller default", () => {
    const url = process.env.DATABASE_URL ?? "";
    assert.ok(url.startsWith(APP_URL));
    assert.match(url, /connection_limit=5/, "DB_POOL_SIZE default, unchanged by this fix");
  });

  it("gives the admin pool room the app pool does not need", () => {
    // One admin connection may be parked on the run lock for the length of a
    // sweep while the same pool serves the crons that fan out beside it. At
    // the app pool's five, the sweep would contend with itself.
    const admin = Number(/connection_limit=(\d+)/.exec(process.env.ADMIN_DATABASE_URL ?? "")?.[1]);
    const app = Number(/connection_limit=(\d+)/.exec(process.env.DATABASE_URL ?? "")?.[1]);
    assert.ok(admin > app, `admin ${admin} must exceed app ${app}`);
  });
});
