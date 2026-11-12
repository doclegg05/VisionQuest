import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const robotsUrl = new URL("../../public/robots.txt", import.meta.url);

test("public/robots.txt exists", () => {
  assert.ok(existsSync(robotsUrl), "public/robots.txt must exist so /robots.txt is not a 404");
});

test("robots.txt disallows every crawler from everything", () => {
  const lines = readFileSync(robotsUrl, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  assert.deepEqual(lines, ["User-agent: *", "Disallow: /"]);
});
