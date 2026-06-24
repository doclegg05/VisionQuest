import assert from "node:assert/strict";
import { before, test } from "node:test";

let extractPagesFromBuffer: typeof import("./extract").extractPagesFromBuffer;

before(async () => {
  const mod = await import("./extract");
  extractPagesFromBuffer = mod.extractPagesFromBuffer;
});

test("extractPagesFromBuffer returns one entry per page for txt", async () => {
  const buf = Buffer.from("alpha\n\nbeta", "utf-8");
  const result = await extractPagesFromBuffer(buf, ".txt");
  assert.ok(result);
  assert.equal(result.pageCount, 1);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].pageNumber, 1);
  assert.match(result.pages[0].text, /alpha/);
});

test("extractPagesFromBuffer returns null for empty buffer", async () => {
  assert.equal(await extractPagesFromBuffer(Buffer.alloc(0), ".pdf"), null);
});
