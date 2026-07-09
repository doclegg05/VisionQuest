import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOrientationPacket } from "./orientation-packet";
import { FORMS } from "./forms";

describe("getOrientationPacket", () => {
  it("includes every onboarding form exactly once across printable + paperOnly", () => {
    const { printable, paperOnly } = getOrientationPacket();
    const packetIds = [...printable, ...paperOnly].map((f) => f.id).sort();
    const onboardingIds = FORMS
      .filter((f) => f.category === "onboarding")
      .map((f) => f.id)
      .sort();
    assert.deepEqual(packetIds, onboardingIds);
    // No form leaks into both buckets.
    assert.equal(new Set(packetIds).size, packetIds.length);
  });

  it("only onboarding forms are in the packet — no other category leaks in", () => {
    const { printable, paperOnly } = getOrientationPacket();
    for (const form of [...printable, ...paperOnly]) {
      assert.equal(form.category, "onboarding");
    }
  });

  it("every printable form has a non-null storageKey (safe to fetch + merge)", () => {
    const { printable } = getOrientationPacket();
    assert.ok(printable.length > 0, "expected at least one printable form");
    for (const form of printable) {
      assert.notEqual(form.storageKey, null);
      assert.equal(typeof form.storageKey, "string");
    }
  });

  it("every paperOnly form has a null storageKey (must be flagged, not fetched)", () => {
    const { paperOnly } = getOrientationPacket();
    for (const form of paperOnly) {
      assert.equal(form.storageKey, null);
    }
  });

  it("flags the two known PDF-less onboarding forms as paper-only", () => {
    // ai-data-consent and learning-styles have storageKey: null in forms.ts.
    // If a real PDF is later attached, they should migrate to printable and
    // this assertion should be updated deliberately.
    const paperIds = getOrientationPacket().paperOnly.map((f) => f.id).sort();
    assert.deepEqual(paperIds, ["ai-data-consent", "learning-styles"]);
  });

  it("orders printable forms by ascending sortOrder", () => {
    const { printable } = getOrientationPacket();
    for (let i = 1; i < printable.length; i += 1) {
      assert.ok(
        printable[i - 1].sortOrder <= printable[i].sortOrder,
        `out of order at index ${i}: ${printable[i - 1].id} then ${printable[i].id}`,
      );
    }
  });
});
