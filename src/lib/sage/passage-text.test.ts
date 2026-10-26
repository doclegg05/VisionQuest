import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPassageText } from "./passage-text";

test("rejects parser separators and form buttons as standalone evidence", () => {
  for (const text of ["", "-- 1 of 1 --", "Print\n\n-- 1 of 3 --\n-- 2 of 3 --", "Reset\r\nSubmit"])
    assert.equal(cleanPassageText(text), "");
});

test("preserves short real instructions and removes only standalone separators", () => {
  assert.equal(cleanPassageText("Print your certificate."), "Print your certificate.");
  assert.equal(cleanPassageText("Print\nSubmit the signed form.\n-- 1 of 2 --"), "Print\nSubmit the signed form.");
  assert.equal(cleanPassageText("Example: -- 1 of 2 -- appears in the export."), "Example: -- 1 of 2 -- appears in the export.");
});
