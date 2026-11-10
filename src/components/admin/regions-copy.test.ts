import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAIN_LANGUAGE_IDEAL_GRADE, assessReadability } from "@/lib/sage/readability";
import {
  REGIONS_COPY,
  archiveConfirm,
  classCountLabel,
  regionCountLabel,
  removeCoordinatorConfirm,
} from "./regions-copy";

describe("regions copy", () => {
  it("tells an admin on an empty system what to do first", () => {
    assert.equal(
      REGIONS_COPY.empty,
      "No regions yet. Add your first region. You need one before you can create a class or invite staff.",
    );
  });

  it("counts classes in plain words", () => {
    assert.equal(classCountLabel(0), "No classes yet");
    assert.equal(classCountLabel(1), "1 class");
    assert.equal(classCountLabel(4), "4 classes");
  });

  it("counts regions in plain words, and says how many are archived", () => {
    assert.equal(regionCountLabel(0, 0), "No regions yet");
    assert.equal(regionCountLabel(1, 0), "1 region");
    assert.equal(regionCountLabel(3, 0), "3 regions");
    assert.equal(regionCountLabel(3, 2), "3 regions, 2 archived");
    assert.equal(regionCountLabel(0, 1), "No active regions, 1 archived");
  });

  it("names the region and says what archiving does", () => {
    const dialog = archiveConfirm({ name: "North", classCount: 2 });
    assert.equal(dialog.title, "Archive North?");
    assert.equal(dialog.confirmLabel, "Archive region");
    assert.match(dialog.message, /2 classes stay in it/);
    assert.match(dialog.message, /restore it later/);
    assert.equal(dialog.destructive, false, "an archive can be undone, so the button is not red");
  });

  it("warns when a coordinator is about to lose their only region", () => {
    const last = removeCoordinatorConfirm({ personName: "Pat Lee", regionName: "North", onlyRegion: true });
    assert.equal(last.title, "Remove Pat Lee from North?");
    assert.match(last.message, /only region/);
    assert.equal(last.destructive, true, "this takes access away, so the button is red");
    const other = removeCoordinatorConfirm({ personName: "Pat Lee", regionName: "North", onlyRegion: false });
    assert.doesNotMatch(other.message, /only region/);
  });
});

describe("regions copy reading level", () => {
  const built = [
    archiveConfirm({ name: "North", classCount: 0 }).message,
    archiveConfirm({ name: "North", classCount: 2 }).message,
    removeCoordinatorConfirm({ personName: "Pat Lee", regionName: "North", onlyRegion: true }).message,
    removeCoordinatorConfirm({ personName: "Pat Lee", regionName: "North", onlyRegion: false }).message,
  ];
  const all = [...Object.values(REGIONS_COPY), ...built];

  it("has copy to check", () => {
    assert.ok(all.length > 10);
    assert.ok(all.every((text) => text.trim().length > 0), "no copy string is blank");
  });

  // The same scorer and the same 12-word floor as scripts/ui-copy-readability.mjs,
  // held to the ideal grade because that script does not scan this folder.
  for (const text of all) {
    const result = assessReadability(text, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    if (!result.scorable) continue;
    it(`reads at grade ${PLAIN_LANGUAGE_IDEAL_GRADE} or lower: "${text.slice(0, 50)}"`, () => {
      assert.ok(result.grade <= PLAIN_LANGUAGE_IDEAL_GRADE, `grade ${result.grade}: ${text}`);
    });
  }
});
