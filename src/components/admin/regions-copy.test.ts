import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PLAIN_LANGUAGE_IDEAL_GRADE, assessReadability } from "@/lib/sage/readability";
import {
  INVITE_HINTS,
  REGION_MESSAGES,
  REGIONS_COPY,
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

  it("says in plain words what went wrong and what to do", () => {
    assert.equal(REGION_MESSAGES.changedElsewhere, "This region was changed somewhere else. Reload the page.");
    assert.equal(REGION_MESSAGES.sameName("North"), "There is already a region called North.");
    assert.equal(REGION_MESSAGES.codeFromName("north-central"), "Short code: north-central (made from the name)");
    assert.equal(REGIONS_COPY.codeHelp, "A short ID for this region, used in reports. Letters, numbers and dashes only.");
    assert.equal(REGIONS_COPY.changeCode, "Change it");
  });

  it("counts regions in plain words", () => {
    assert.equal(regionCountLabel(0), "No regions yet");
    assert.equal(regionCountLabel(1), "1 region");
    assert.equal(regionCountLabel(3), "3 regions");
  });

  it("has no words for archiving or restoring, which this screen does not offer", () => {
    const words = JSON.stringify(REGIONS_COPY);
    assert.doesNotMatch(words, /archiv|restor/i);
  });

  it("warns when a coordinator is about to lose their only region", () => {
    const last = removeCoordinatorConfirm({ personName: "Pat Lee", regionName: "North", onlyRegion: true });
    assert.equal(last.title, "Remove Pat Lee from North?");
    assert.equal(
      last.message,
      "This is their only region. After this, they will not see any classes. You can add them back until you leave this page. After that, they will not show in the list.",
    );
    assert.equal(last.destructive, true, "this takes access away, so the button is red");
    const other = removeCoordinatorConfirm({ personName: "Pat Lee", regionName: "North", onlyRegion: false });
    assert.doesNotMatch(other.message, /only region/);
  });
});

describe("regions copy reading level", () => {
  const built = [
    REGION_MESSAGES.codeTaken("north"),
    REGION_MESSAGES.changedElsewhere,
    REGION_MESSAGES.sameName("North"),
    REGION_MESSAGES.codeFromName("north-central"),
    removeCoordinatorConfirm({ personName: "Pat Lee", regionName: "North", onlyRegion: true }).message,
    removeCoordinatorConfirm({ personName: "Pat Lee", regionName: "North", onlyRegion: false }).message,
    ...[INVITE_HINTS.noChoices("North"), INVITE_HINTS.notInList].map((hint) => `${hint.before}${hint.link}${hint.after}`),
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
