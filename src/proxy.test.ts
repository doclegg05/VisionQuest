import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crawlerHeadersFor } from "./proxy";

// FERPA review W7 (2026-09-06): the two public pages that render one
// student's data behind an opaque identifier — /credentials/[slug] and
// /connect/[token] — carried no `noindex`, and the repo has no robots.txt.
// The page-level `robots` metadata covers HTML; this header covers every
// response under those prefixes, including the PDF the employer page links.

describe("crawlerHeadersFor", () => {
  it("marks /credentials/* noindex, nofollow", () => {
    assert.deepEqual(crawlerHeadersFor("/credentials/tanesha-rivers"), {
      "X-Robots-Tag": "noindex, nofollow",
    });
  });

  it("marks /connect/* noindex, nofollow", () => {
    assert.deepEqual(crawlerHeadersFor("/connect/hQ7nZ2xK9vB4mL0pR6sT8wY1cD3fG5jN7qA2eU4iO6k"), {
      "X-Robots-Tag": "noindex, nofollow",
    });
  });

  it("covers the bare prefix too", () => {
    assert.deepEqual(crawlerHeadersFor("/connect"), { "X-Robots-Tag": "noindex, nofollow" });
    assert.deepEqual(crawlerHeadersFor("/credentials"), { "X-Robots-Tag": "noindex, nofollow" });
  });

  it("leaves the staff console and everything else alone", () => {
    for (const pathname of ["/teacher/connect", "/teacher/connect/report", "/", "/dashboard", "/connections", "/api/health"]) {
      assert.deepEqual(crawlerHeadersFor(pathname), {}, pathname);
    }
  });
});
