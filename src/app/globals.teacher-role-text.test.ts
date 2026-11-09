import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composite, contrastRatio, cssTokenValue, parseColor } from "@/lib/wcag-contrast";

const root = process.cwd();
const css = readFileSync(join(root, "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const read = (file: string) => readFileSync(join(root, file), "utf8");

const QUEUE = "src/components/teacher/InterventionQueuePanel.tsx";
const APPOINTMENTS = "src/components/teacher/class-overview/UpcomingAppointments.tsx";

describe("teacher eyebrows use role text, not fill tokens as text", () => {
  it("Needs attention eyebrow is text-success, not --accent-strong", () => {
    const line = read(QUEUE).split("\n").find((l) => l.includes("uppercase") && l.includes("tracking-[0.18em]"));
    assert.ok(line, "eyebrow line");
    assert.match(line, /text-success\b/);
    assert.doesNotMatch(line, /--accent-strong/);
  });

  it("This week eyebrow and pills are text-info, not --accent-secondary", () => {
    const source = read(APPOINTMENTS);
    assert.doesNotMatch(source, /text-\[var\(--accent-secondary\)\]/);
    assert.ok((source.match(/text-info\b/g) ?? []).length >= 3);
  });

  for (const theme of ["light", "dark"] as const) {
    const token = (name: string) => cssTokenValue(css, name, theme) as string;
    const raised = token("--surface-raised");
    const muted = composite(parseColor(token("--surface-muted")), parseColor(raised));

    it(`${theme} theme: --success-text clears 4.5:1 on the card`, () => {
      const ratio = contrastRatio(token("--success-text"), raised);
      assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
    });

    it(`${theme} theme: --info-text clears 4.5:1 on the card and on the muted pill`, () => {
      for (const [name, ground] of [["card", raised], ["muted pill", muted]] as const) {
        const ratio = contrastRatio(token("--info-text"), ground);
        assert.ok(ratio >= 4.5, `${name} ${ratio.toFixed(2)}:1`);
      }
    });
  }
});
