// =============================================================================
// The e2e specs that write global state must not be able to reach production.
//
// `e2e/helpers/db.ts` is how placement-bridge.spec.ts and the Connect journey
// spec get a Prisma client, and both of them flip SystemConfig rows that are
// program-wide rather than per-test — `placement_bridge_classes` and
// `connect_enabled_classes`. A run pointed at the wrong database does not fail
// loudly; it closes a feature for the real pilot class and says nothing.
//
// That is not hypothetical. `resolveDatabaseUrl()` falls back to reading
// `.env.local`, and on the owner's machine `.env.local`'s DATABASE_URL is
// production (MEMORY.md, Known Issues: "the only Supabase project is
// production"). So the unguarded default was: run the spec, write production.
//
// This case pins the guard at the helper, not in either spec, because the
// hazard belongs to anything that opens this client.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPrisma } from "../../e2e/helpers/db";

function withDatabaseUrl<T>(value: string, body: () => T): T {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = value;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

describe("createPrisma", () => {
  it("refuses a production-shaped host", () => {
    withDatabaseUrl("postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres", () => {
      assert.throws(
        () => createPrisma(),
        /Refusing to seed e2e fixtures/,
        "the e2e helper opened a client against a production-shaped host",
      );
    });
  });

  it("refuses any host that is neither local nor CI-scoped", () => {
    withDatabaseUrl("postgresql://u:p@visionquest.internal:5432/visionquest", () => {
      assert.throws(() => createPrisma(), /Refusing to seed e2e fixtures/);
    });
  });

  it("allows a local database", () => {
    withDatabaseUrl("postgresql://postgres@127.0.0.1:5433/visionquest_local?schema=public", () => {
      const prisma = createPrisma();
      assert.ok(prisma);
    });
  });
});
