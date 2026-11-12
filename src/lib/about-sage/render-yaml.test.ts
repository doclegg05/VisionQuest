import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SAGE_NOTICE_SECTIONS } from "./notice";

// The notice says "VisionQuest has turned off outside AI tools, like
// Google, for Sage." That is true only while render.yaml deploys with
// AI_LOCAL_ONLY set to the literal "true" (src/lib/boot-probes.ts refuses to
// start without an explicit choice). If this test fails, change that notice
// sentence and SAGE_NOTICE_VERSION in src/lib/about-sage/notice.ts first.

const NOTICE_LINE = "VisionQuest has turned off outside AI tools, like Google, for Sage.";

function aiLocalOnlyValue(yaml: string): string | null {
  const match = yaml.match(/-\s*key:\s*AI_LOCAL_ONLY\s*\n\s*value:\s*(\S+)/);
  return match ? match[1] : null;
}

describe("render.yaml keeps the outside AI promise true", () => {
  it("deploys with AI_LOCAL_ONLY set to the literal true", () => {
    const value = aiLocalOnlyValue(readFileSync("render.yaml", "utf8"));
    assert.equal(
      value,
      '"true"',
      `render.yaml AI_LOCAL_ONLY is ${value ?? "missing"}. The Sage notice says "${NOTICE_LINE}" ` +
        "Change that sentence and SAGE_NOTICE_VERSION in src/lib/about-sage/notice.ts before this deploy setting.",
    );
  });

  it("is guarding a sentence the notice still has", () => {
    const sentences = SAGE_NOTICE_SECTIONS.flatMap((section) => section.sentences);
    assert.ok(sentences.includes(NOTICE_LINE), "update NOTICE_LINE here if the notice sentence changed");
  });

  it("reads the value the way render.yaml writes it", () => {
    assert.equal(aiLocalOnlyValue('      - key: AI_LOCAL_ONLY\n        value: "false"\n'), '"false"');
    assert.equal(aiLocalOnlyValue("      - key: OTHER\n        value: x\n"), null);
  });
});
