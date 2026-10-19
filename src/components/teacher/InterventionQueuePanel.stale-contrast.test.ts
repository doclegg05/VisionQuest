import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@tailwindcss/node";
import { composite, contrastRatio, cssTokenValue, parseColor, type Rgba } from "@/lib/wcag-contrast";

/**
 * The stale-queue warning ("Could not refresh the queue") shipped at 1.51:1 in
 * the dark theme (PR #249, review finding G249-1). Its text used --error, a
 * fill token that keeps the light theme's mauve on a navy card.
 *
 * This reads the warning's real classes from the component, compiles them with
 * the installed Tailwind to see which tokens they paint, and measures the text
 * on its box over the panel card, at the card's sheen-lit top and below it.
 * WCAG AA for this text size is 4.5:1.
 */
const ROOT = process.cwd();
const source = readFileSync(join(ROOT, "src/components/teacher/InterventionQueuePanel.tsx"), "utf8");
const globalsSource = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const tokens = globalsSource.replace(/\/\*[\s\S]*?\*\//g, "");
type Theme = "light" | "dark";

const WARNING = /role="alert"\s+className="([^"]+)"\s*>\s*<p className="([^"]+)">\s*Could not refresh the queue\./;
const match = source.match(WARNING);
const boxClasses = match ? match[1].split(/\s+/) : [];
const textClasses = match ? match[2].split(/\s+/) : [];

let built = "";
before(async () => {
  const compiler = await compile(globalsSource, { base: join(ROOT, "src/app"), onDependency: () => {} });
  built = compiler.build([...boxClasses, ...textClasses]);
});

function rule(className: string): string {
  const selector = `.${className.replace(/[/:[\]().]/g, (c) => `\\${c}`)} {`;
  const start = built.indexOf(selector);
  return start < 0 ? "" : built.slice(start, built.indexOf("}", start));
}

/** The one token a class list paints for `property`, read from the compiled CSS. */
function paintedToken(classes: string[], property: "color" | "background-color"): string {
  const pattern = new RegExp(`(?:^|[\\s;{])${property}:\\s*var\\((--[a-z0-9-]+)\\)`);
  const found = classes.map((c) => rule(c).match(pattern)?.[1]).filter((t): t is string => Boolean(t));
  assert.equal(found.length, 1, `expected one ${property} token in "${classes.join(" ")}", got [${found.join(", ")}]`);
  return found[0];
}

function resolve(name: string, theme: Theme): Rgba {
  const value = cssTokenValue(tokens, name, theme);
  assert.ok(value, `${name} is not declared`);
  const alias = value.match(/^var\((--[a-z0-9-]+)\)$/);
  return alias ? resolve(alias[1], theme) : parseColor(value);
}

describe("intervention queue stale warning contrast", () => {
  it("finds the warning and its box in the component", () => {
    assert.ok(match, "the stale warning markup moved; update WARNING");
  });

  for (const theme of ["light", "dark"] as const) {
    it(`clears 4.5:1 on its box in the ${theme} theme`, () => {
      const text = resolve(paintedToken(textClasses, "color"), theme);
      const box = resolve(paintedToken(boxClasses, "background-color"), theme);
      const page = resolve("--surface-base", theme);
      const card = parseColor(composite(resolve("--surface-raised", theme), page));
      const cardTop = parseColor(composite(resolve("--surface-sheen", theme), card));
      const grounds = [["box over card", card], ["box over card top", cardTop]] as const;

      const failing = grounds
        .map(([where, ground]) => {
          const boxGround = composite(box, ground);
          return { where, ratio: contrastRatio(composite(text, parseColor(boxGround)), boxGround) };
        })
        .filter(({ ratio }) => ratio < 4.5)
        .map(({ where, ratio }) => `${where} ${ratio.toFixed(2)}:1`);
      assert.deepEqual(failing, []);
    });
  }
});
