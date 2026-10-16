import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const INTERNAL_DIR = path.join(process.cwd(), "src/app/api/internal");

function internalRouteFiles(): string[] {
  return readdirSync(INTERNAL_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => path.basename(file) === "route.ts")
    .map((file) => path.join("src/app/api/internal", file))
    .sort();
}

// These routes carry no session: pg_cron reaches them with only the
// CRON_SECRET bearer. A GET skips the proxy's CSRF check, and anyone can send
// an Origin header that passes it, so the route's own check is the one an
// attacker can time. A `===` compare stops at the first wrong character and
// leaks the secret a prefix at a time; the shared helper compares fixed-length
// digests (src/lib/csrf.ts).
describe("sessionless /api/internal routes", () => {
  const files = internalRouteFiles();

  it("finds the routes it guards", () => {
    assert.ok(files.length >= 13, `expected at least 13 internal routes, found ${files.length}`);
  });

  for (const file of files) {
    it(`${file} checks the cron bearer through the shared constant-time helper`, () => {
      const source = readFileSync(file, "utf8");
      assert.match(source, /from "@\/lib\/csrf"/, `${file} does not import the shared check`);
      assert.match(source, /isAuthorizedInternal(Route|Request)\(/, `${file} does not call the shared check`);
      assert.doesNotMatch(
        source,
        /[!=]==?\s*`Bearer \$\{/,
        `${file} compares the bearer with ===, which leaks the secret through timing`,
      );
    });
  }
});
