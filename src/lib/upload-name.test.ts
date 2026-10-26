import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeUploadName } from "./upload-name";

/**
 * `File.name` is student-controlled and undici preserves it verbatim, so the
 * name a student types into their own file picker becomes a string this
 * program stores and later hands to code that treats it as a path. This is
 * the upload-time half of that fix: keep the name readable for the student,
 * but strip anything that makes it a path rather than a name.
 */
describe("safeUploadName", () => {
  it("keeps an ordinary filename unchanged", () => {
    assert.equal(safeUploadName("Resume 2026 (final).pdf"), "Resume 2026 (final).pdf");
  });

  it("drops every path component from a POSIX traversal name", () => {
    assert.equal(safeUploadName("../../../../etc/cron.d/x"), "x");
    assert.equal(safeUploadName("/etc/passwd"), "passwd");
  });

  it("drops path components from a Windows-style traversal name", () => {
    assert.equal(safeUploadName("..\\..\\..\\home\\staff\\.bashrc"), "bashrc");
    assert.equal(safeUploadName("C:\\Users\\x\\resume.pdf"), "resume.pdf");
  });

  it("strips NUL and other control characters", () => {
    assert.equal(safeUploadName("resume\u0000.pdf\u0007"), "resume.pdf");
    assert.equal(safeUploadName("re\nsu\tme.pdf"), "resume.pdf");
  });

  // Review suggestion (2026-09-06). `CONTROL_CHARS` covered C0/C1 only, so
  // every invisible formatting character survived — including the bidi
  // overrides. `resume‮fdp.exe` renders in a teacher's file list as
  // `resumeexe.pdf`: a staff member deciding whether to open an attachment
  // reads the reversed name, not the bytes. `safeEntryName` in
  // student-archive.ts already drops these (its allowlist keeps only
  // \p{L}/\p{N} and a little punctuation); this brings the upload-time pass
  // into line so the two agree about what a name may contain.
  it("strips bidi overrides so a name cannot render as a different extension", () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE: displays as "resumeexe.pdf".
    assert.equal(safeUploadName("resume‮fdp.exe"), "resumefdp.exe");
    // The isolate family (U+2066–U+2069) does the same job.
    assert.equal(safeUploadName("⁦invoice⁩.pdf"), "invoice.pdf");
    for (const raw of ["a‪b.pdf", "a‫b.pdf", "a‬b.pdf", "a‭b.pdf"]) {
      assert.equal(safeUploadName(raw), "ab.pdf", `bidi control survived in ${JSON.stringify(raw)}`);
    }
  });

  it("strips zero-width characters, which are invisible collision fodder", () => {
    // Two names that look identical in every list this app renders must not
    // stay distinguishable only by a character nobody can see.
    assert.equal(safeUploadName("resume​.pdf"), "resume.pdf");
    for (const raw of ["a‌b.pdf", "a‍b.pdf", "a‎b.pdf", "a‏b.pdf"]) {
      assert.equal(safeUploadName(raw), "ab.pdf", `zero-width survived in ${JSON.stringify(raw)}`);
    }
  });

  it("strips leading dots so nothing becomes a dotfile", () => {
    assert.equal(safeUploadName(".bashrc"), "bashrc");
    assert.equal(safeUploadName("..."), "file");
  });

  it("falls back to a name when nothing usable is left", () => {
    assert.equal(safeUploadName(""), "file");
    assert.equal(safeUploadName("   "), "file");
    assert.equal(safeUploadName("/"), "file");
    assert.equal(safeUploadName(null), "file");
    assert.equal(safeUploadName(undefined), "file");
  });

  it("caps a 500-character name and keeps the extension", () => {
    const long = `${"a".repeat(500)}.pdf`;
    const result = safeUploadName(long);
    assert.ok(result.length <= 200, `expected <= 200 chars, got ${result.length}`);
    assert.ok(result.endsWith(".pdf"), `extension should survive truncation: ${result}`);
  });

  it("preserves unicode letters — a readable name is the point", () => {
    assert.equal(safeUploadName("Currículum señor.pdf"), "Currículum señor.pdf");
    assert.equal(safeUploadName("履歴書.pdf"), "履歴書.pdf");
  });

  it("never returns a name containing a separator or a parent segment", () => {
    for (const raw of [
      "../../x",
      "..\\..\\x",
      "a/b/c.pdf",
      "..",
      "....//....//x",
      "foo/../../bar.pdf",
    ]) {
      const result = safeUploadName(raw);
      assert.ok(!result.includes("/"), `"${raw}" -> "${result}" still contains /`);
      assert.ok(!result.includes("\\"), `"${raw}" -> "${result}" still contains \\`);
      assert.notEqual(result, "..");
      assert.ok(!result.startsWith("."), `"${raw}" -> "${result}" starts with .`);
    }
  });
});
