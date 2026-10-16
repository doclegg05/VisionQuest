# SPOKES Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring VisionQuest's look in line with the SPOKES Design System in four PRs: tokens, student sweep, remaining sweep, polish.

**Architecture:** SPOKES values live in `src/app/globals.css` as theme-aware tokens. Tailwind 4's `@theme inline` exposes role utilities (`bg-danger`, `text-danger`, `border-danger`) through per-property namespaces (`--text-color-*`, `--border-color-*` and the rest are read before `--color-*`; verified on the installed Tailwind 4.3.3 during planning). A pure class-mapping module plus a TypeScript-AST source rewriter moves component class strings onto those roles, and a local ESLint rule keeps them there. Tests read `globals.css` and the compiled Tailwind output, so every color and contrast claim runs in CI.

**Tech Stack:** Next.js 16, Tailwind CSS 4.3 (`@theme inline`; `@tailwindcss/node` compile in one test), TypeScript, `node:test` through `tsx`, ESLint 9 flat config, Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-10-15-spokes-design-system-design.md` (read its "Revisions during planning" section first: this plan implements the revised values).

## Global Constraints

- Allowed colors: `#007baf` primary, `#37b550` accent, `#004071` dark, `#ffffff` light, `#edf3f7` muted, `#60636b` gray, `#d3b257` gold, `#00133f` royal, `#a7253f` mauve, `#d1d3d4` offwhite, `#ad8806` muted-gold, `#1e7a2e` accent-text. Any alpha of these is allowed. Named `white` and `transparent` are allowed; no other named color.
- Contrast: 4.5:1 for text; 3:1 for large text, control borders, focus indicators, and progress-bar edges. Both themes.
- Fonts: DM Serif Display, weight 400 only (`--font-display`); Outfit (`--font-body`).
- Nothing renders below 13px.
- Focus: light theme 2px `#004071` outline at 3px offset with a 7px `rgba(211, 178, 87, 0.55)` halo; dark theme 2px `#d3b257` outline.
- Every control stays at 44px or larger; HIG Phase 1 and 2 guards (`src/components/__tests__/touch-targets.test.ts` and others) must keep passing.
- No Sage prompt text changes. `SAGE_PROMPT_REVISION` does not move.
- Never read `.env.local`. Run nothing against a database locally: the only Supabase project is production. Authenticated browser checks run in CI.
- `git push`, `gh`, and `git worktree add` are blocked by this Mac's session sandbox. Run them in the Terminal panel, and only with Britt's OK in the session.
- Commit subjects use `<type>: <description>` with no attribution trailers. Docs prose has no em dashes.
- Unlayered CSS in `globals.css` beats Tailwind utilities (Known Issues in `.claude/MEMORY.md`). New reusable classes go in `@layer components`.
- `src/app/globals.css` was 1,045 lines before this work, already over the 800-line file rule. Splitting it would mean rewriting four HIG Phase 2 graders that read it by path, so this plan leaves the split for a follow-up and each PR description says so.

## Review Focus

1. **Dark-theme errors have no red.** No SPOKES red passes on navy, so danger text is white in the dark theme. A wrong-password error must still read as an error: its `role="alert"` box shows an icon in both themes. Test: Task 8, `e2e/spokes-visual.spec.ts` "sign-in error carries an icon".
2. **Nothing scrolls sideways at phone width.** Serif titles set wider than Sora, and small text grows 1px. Test: Task 1, every captured page asserts `scrollWidth - innerWidth <= 0` at 375px and 1280px.
3. **Class strings the codemod cannot see whole.** `` `bg-${tone}-100` ``, `{ "bg-red-50": isError }` object keys, and `data-[state=open]:bg-red-50` variants must be rewritten or listed for review, never skipped silently. Test: Tasks 5 and 6.
4. **Program badges without color.** A color-blind teacher must still tell SPOKES, Adult Ed, and IETP apart. Test: Task 8, `ProgramBadge.test.tsx` asserts only the IETP badge is outlined.
5. **Reduced motion and the new lifts.** People who ask for reduced motion must not see buttons or cards jump on hover. Test: Task 7, `src/app/globals.motion.test.ts`.

---

## Task 0: Start from `main` after HIG Phase 2

**Files:** none changed.

- [ ] **Step 1: Confirm HIG Phase 2 merged.** In the Terminal panel:

```bash
gh pr view 223 --repo doclegg05/VisionQuest --json state,mergedAt
```

Expected: `"state":"MERGED"`. If it is not merged, stop. This plan is written against that branch's files.

- [ ] **Step 2: Rebase the design branch.** The branch holds only the spec and plan commits.

```bash
cd /Users/brittlegg/MacDev/companies/education/VisionQuest/.claude/worktrees/spokes-design
git fetch origin
git rebase origin/main
```

- [ ] **Step 3: Confirm the token file matches what this plan read.** The plan was written against blob `0aed6f5b5e25d70f4192279058a17c4fe267ff65` of `src/app/globals.css` on `fix/hig-phase-2`.

```bash
git diff --stat 0aed6f5b5e25d70f4192279058a17c4fe267ff65 HEAD:src/app/globals.css
```

Expected: no output. If there is output, read the changed lines and carry any new token into the blocks in Task 7 before starting it.

- [ ] **Step 4: Install into the worktree.** A worktree without its own `node_modules` borrows the main checkout's Prisma client (Known Issues).

```bash
npm ci
npx prisma generate
```

- [ ] **Step 5: Record the baseline.**

```bash
npm test 2>&1 | tail -4
npm run lint 2>&1 | tail -3
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit; echo "tsc exit $?"
```

Expected: `# fail 0`, lint exit 0, `tsc exit 0`. Save the pass count; every later task compares against it.

- [ ] **Step 6: Re-measure the sweep.**

```bash
P='(bg|text|border|from|to|via|ring|fill|stroke|outline|divide|decoration|accent|caret)-(red|amber|yellow|orange|purple|violet|indigo|pink|rose|emerald|teal|cyan|sky|lime|fuchsia|green|blue|slate|gray|zinc|neutral|stone)-[0-9]{2,3}'
git grep -ohE "$P" -- 'src/**/*.tsx' 'src/**/*.ts' | wc -l
```

Expected: about 382 (the count on `fix/hig-phase-2`). A much larger number means HIG Phase 2 changed in review; report it to Britt before continuing.

---

# PR 1: Tokens

Branch: `design/spokes-design-system` (this worktree).

## Task 1: Screenshot capture for the design review

The first push of this PR must contain only this task, so its CI run captures the "before" screenshots.

**Files:**
- Create: `e2e/spokes-visual.spec.ts`
- Create: `scripts/spokes-gallery.mjs`
- Modify: `.github/workflows/ci.yml` (e2e job, after the authenticated a11y gate step, the one whose name ends `authenticated a11y (own login budget)`)
- Modify: `.gitignore`

**Interfaces:**
- Produces: CI artifact `spokes-visual`, PNGs named `<page>-<theme>-<width>.png`; `node scripts/spokes-gallery.mjs <before-dir|-> <after-dir> <out-dir>` writes `<out-dir>/index.html` plus `before/` and `after/` copies.

- [ ] **Step 1: Write the capture spec.**

```ts
// e2e/spokes-visual.spec.ts
import { test, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { E2E_STUDENT, E2E_TEACHER } from "./fixtures";
import { loginContext } from "./helpers/auth";

/**
 * Screenshot set for the SPOKES design review
 * (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md).
 * CI uploads OUT as the `spokes-visual` artifact, and
 * scripts/spokes-gallery.mjs turns two runs into a before/after page.
 * It asserts only that no page scrolls sideways.
 */
const OUT = "spokes-visual";
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "1280", width: 1280, height: 800 },
] as const;
const STUDENT_PAGES = [
  ["dashboard", "/dashboard"],
  ["goals", "/goals"],
  ["orientation", "/orientation"],
  ["portfolio", "/portfolio"],
  ["career", "/career"],
] as const;

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

async function setTheme(context: BrowserContext, theme: Theme): Promise<void> {
  const { origin } = new URL(test.info().project.use.baseURL ?? "http://localhost:3000");
  await context.addCookies([{ name: "vq-theme", value: theme, url: origin }]);
}

async function capture(page: Page, name: string, path: string, theme: Theme): Promise<void> {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(path);
    await page.waitForTimeout(1_500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect.soft(overflow, `${name} (${theme}, ${viewport.name}px) scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-${viewport.name}.png`, fullPage: true });
  }
}

async function teacherDetailPath(context: BrowserContext): Promise<string> {
  const response = await context.request.get("/api/teacher/intervention-queue");
  expect(response.ok()).toBe(true);
  const body: { queue: Array<{ studentId: string; publicStudentId: string }> } = await response.json();
  const seeded = body.queue.find((entry) => entry.publicStudentId === E2E_STUDENT.login);
  if (!seeded) throw new Error(`${E2E_STUDENT.login} is not in the intervention queue; run scripts/seed-e2e-users.ts`);
  return `/teacher/students/${seeded.studentId}`;
}

async function withPage(context: BrowserContext, run: (page: Page) => Promise<void>): Promise<void> {
  try {
    const page = await context.newPage();
    await run(page);
  } finally {
    await context.close();
  }
}

test("sign-in page", async ({ browser }) => {
  for (const theme of THEMES) {
    const context = await browser.newContext();
    await setTheme(context, theme);
    await withPage(context, (page) => capture(page, "sign-in", "/", theme));
  }
});

test("student pages", async ({ browser }) => {
  const context = await loginContext(browser, E2E_STUDENT);
  await withPage(context, async (page) => {
    for (const theme of THEMES) {
      await setTheme(context, theme);
      for (const [name, path] of STUDENT_PAGES) await capture(page, name, path, theme);
    }
  });
});

test("teacher pages", async ({ browser }) => {
  const context = await loginContext(browser, E2E_TEACHER);
  await withPage(context, async (page) => {
    const detail = await teacherDetailPath(context);
    for (const theme of THEMES) {
      await setTheme(context, theme);
      await capture(page, "teacher-queue", "/teacher", theme);
      await capture(page, "student-detail", detail, theme);
    }
  });
});
```

- [ ] **Step 2: Write the gallery script.**

```js
// scripts/spokes-gallery.mjs
// node scripts/spokes-gallery.mjs <before-dir|-> <after-dir> <out-dir>
// Builds a before/after page from two `spokes-visual` CI artifacts for Britt's review.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [beforeDir, afterDir, outDir] = process.argv.slice(2);
if (!beforeDir || !afterDir || !outDir) {
  console.error("usage: node scripts/spokes-gallery.mjs <before-dir|-> <after-dir> <out-dir>");
  process.exit(2);
}

const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function figure(side, file, label) {
  return `<figure><img src="${side}/${file}" alt="${side === "before" ? "Before" : "After"}: ${label}" loading="lazy"><figcaption>${side === "before" ? "Before" : "After"}</figcaption></figure>`;
}

mkdirSync(join(outDir, "after"), { recursive: true });
mkdirSync(join(outDir, "before"), { recursive: true });
const shots = readdirSync(afterDir).filter((f) => f.endsWith(".png")).sort();
const sections = shots.map((file) => {
  copyFileSync(join(afterDir, file), join(outDir, "after", file));
  const hasBefore = beforeDir !== "-" && existsSync(join(beforeDir, file));
  if (hasBefore) copyFileSync(join(beforeDir, file), join(outDir, "before", file));
  const label = escapeHtml(file.replace(/\.png$/, "").replaceAll("-", " "));
  return `<section><h2>${label}</h2><div class="pair">${hasBefore ? figure("before", file, label) : ""}${figure("after", file, label)}</div></section>`;
});

writeFileSync(join(outDir, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPOKES Design Review</title>
<style>
:root { --bg: #edf3f7; --ink: #004071; --muted: #60636b; --card: #ffffff; --line: #d1d3d4; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #00133f; --ink: #ffffff; --muted: rgba(255, 255, 255, 0.75); --card: #004071; --line: rgba(255, 255, 255, 0.12); } }
:root[data-theme="dark"] { --bg: #00133f; --ink: #ffffff; --muted: rgba(255, 255, 255, 0.75); --card: #004071; --line: rgba(255, 255, 255, 0.12); }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, sans-serif; }
h1 { font-family: Georgia, serif; font-weight: 400; margin: 0 0 24px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 0 auto 24px; max-width: 1400px; }
h2 { font-size: 17px; margin: 0 0 12px; text-transform: capitalize; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; }
figure { margin: 0; } img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; }
figcaption { color: var(--muted); font-size: 13px; margin-top: 4px; }
</style></head><body><h1>SPOKES Design Review</h1>
${sections.join("\n")}
</body></html>
`);
console.log(`${shots.length} screenshot(s) written to ${join(outDir, "index.html")}`);
```

- [ ] **Step 3: Add the CI steps.** Insert directly after the step whose name ends `authenticated a11y (own login budget)` in the e2e job of `.github/workflows/ci.yml`:

```yaml
      # SPOKES design review screenshots. Not a gate yet: Task 12 removes
      # continue-on-error once the first full run is clean. The seed re-runs
      # first for the same login-budget reason as the step above.
      - name: SPOKES design review screenshots
        continue-on-error: true
        run: |
          npx tsx scripts/seed-e2e-users.ts >/dev/null
          npx playwright test e2e/spokes-visual.spec.ts --workers=1 --reporter=line --timeout=180000

      - name: Upload SPOKES review screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: spokes-visual
          path: spokes-visual/
          if-no-files-found: warn
```

- [ ] **Step 4: Ignore the local output folder.** Append to `.gitignore`:

```
# SPOKES design review screenshots (e2e/spokes-visual.spec.ts)
spokes-visual/
```

- [ ] **Step 5: Check it compiles and lints.** Local runs of this spec need the app and a database, so it runs only in CI.

```bash
npx playwright test e2e/spokes-visual.spec.ts --list | tail -2
npx eslint e2e/spokes-visual.spec.ts scripts/spokes-gallery.mjs
node scripts/spokes-gallery.mjs - "$TMPDIR/no-such-dir" "$TMPDIR/gallery-probe" 2>&1 | head -2
```

Expected: Playwright lists the three tests (it compiles the spec without starting the app), ESLint prints nothing, and the gallery script fails with `ENOENT` for the missing folder, which proves it runs.

- [ ] **Step 6: Commit and push the baseline.**

```bash
git add e2e/spokes-visual.spec.ts scripts/spokes-gallery.mjs .github/workflows/ci.yml .gitignore
git commit -m "test: capture SPOKES design review screenshots in CI"
```

With Britt's OK, in the Terminal panel:

```bash
git push -u origin design/spokes-design-system
gh pr create --draft --base main --head design/spokes-design-system --title "feat: SPOKES design tokens" --body "Draft. First push captures the before screenshots (CI artifact spokes-visual). Plan: docs/superpowers/plans/2026-10-15-spokes-design-system.md"
```

Record the CI run id for this push; Task 12 downloads its `spokes-visual` artifact as the "before" set.

## Task 2: Palette module

**Files:**
- Create: `src/lib/spokes-palette.json`
- Create: `src/lib/spokes-palette.ts`
- Test: `src/lib/spokes-palette.test.ts`

**Interfaces:**
- Produces: `SPOKES_COLORS: ReadonlyMap<string, string>` (name to `#rrggbb`), `SPOKES_CHART_SERIES: readonly string[]` (six hex values), `isPaletteColor(literal: string): boolean`, `nearestPaletteColor(hex: string): string` (returns a palette name). The JSON is also read by the lint rule in Task 10.

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/spokes-palette.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SPOKES_CHART_SERIES, SPOKES_COLORS, isPaletteColor, nearestPaletteColor } from "./spokes-palette";

describe("SPOKES palette", () => {
  it("holds the 11 SPOKES colors plus accent-text", () => {
    assert.equal(SPOKES_COLORS.size, 12);
    assert.equal(SPOKES_COLORS.get("accent-text"), "#1e7a2e");
  });

  it("accepts palette colors in any case, shorthand, alpha, or rgba form", () => {
    for (const ok of ["#004071", "#004071CC", "#FFF", "rgba(0, 64, 113, 0.05)", "rgb(211, 178, 87)", "white", "transparent"]) {
      assert.ok(isPaletteColor(ok), ok);
    }
  });

  it("rejects everything else", () => {
    for (const bad of ["#c43c3c", "#4a4d54", "black", "rgba(0, 0, 0, 0.5)", "hsl(200 50% 50%)", "rgb(0 64 113 / 5%)"]) {
      assert.equal(isPaletteColor(bad), false, bad);
    }
  });

  it("orders six chart colors from the palette", () => {
    assert.equal(SPOKES_CHART_SERIES.length, 6);
    assert.ok(SPOKES_CHART_SERIES.every(isPaletteColor));
  });

  it("suggests the nearest palette color for a stray hex", () => {
    assert.equal(nearestPaletteColor("#c43c3c"), "mauve");
    assert.equal(nearestPaletteColor("#0a1628"), "royal");
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

```bash
npx tsx --test src/lib/spokes-palette.test.ts
```

Expected: FAIL, `Cannot find module './spokes-palette'`.

- [ ] **Step 3: Write the palette data and module.**

```json
{
  "colors": {
    "primary": "#007baf",
    "accent": "#37b550",
    "dark": "#004071",
    "light": "#ffffff",
    "muted": "#edf3f7",
    "gray": "#60636b",
    "gold": "#d3b257",
    "royal": "#00133f",
    "mauve": "#a7253f",
    "offwhite": "#d1d3d4",
    "muted-gold": "#ad8806",
    "accent-text": "#1e7a2e"
  },
  "chartSeries": ["dark", "gold", "primary", "accent", "mauve", "gray"]
}
```

```ts
// src/lib/spokes-palette.ts
import palette from "./spokes-palette.json";
import { parseColor } from "./wcag-contrast";

/**
 * The SPOKES palette (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md,
 * Design 2.1). spokes-palette.json is the single source: globals.palette.test.ts
 * and the spokes/no-off-palette-color lint rule read it too.
 */
export const SPOKES_COLORS: ReadonlyMap<string, string> = new Map(Object.entries(palette.colors));

function colorNamed(name: string): string {
  const hex = SPOKES_COLORS.get(name);
  if (!hex) throw new Error(`spokes-palette.json chartSeries names unknown color "${name}"`);
  return hex;
}

/** Chart series in an order where neighbors differ in lightness, not only hue. */
export const SPOKES_CHART_SERIES: readonly string[] = palette.chartSeries.map(colorNamed);

const channels = (hex: string) => {
  const { r, g, b } = parseColor(hex);
  return [r, g, b] as const;
};
const PALETTE_RGB = new Set([...SPOKES_COLORS.values()].map((hex) => channels(hex).join(",")));
const ALLOWED_NAMED = new Set(["white", "transparent", "currentcolor"]);

function normalizeHex(value: string): string {
  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const withAlpha = value.match(/^#([0-9a-f]{6})[0-9a-f]{2}$/);
  return withAlpha ? `#${withAlpha[1]}` : value;
}

/** True when a CSS color literal is a SPOKES palette color at any alpha. */
export function isPaletteColor(literal: string): boolean {
  const value = literal.trim().toLowerCase();
  if (ALLOWED_NAMED.has(value)) return true;
  if (!/^#[0-9a-f]{3,8}$|^rgba?\(/.test(value)) return false;
  try {
    return PALETTE_RGB.has(channels(normalizeHex(value)).join(","));
  } catch {
    return false; // parseColor rejects modern space-separated syntax: not allowed in this codebase.
  }
}

/** Name of the palette color closest to `hex` in RGB distance, for hand fixes. */
export function nearestPaletteColor(hex: string): string {
  const [r, g, b] = channels(normalizeHex(hex.toLowerCase()));
  let best = { name: "", distance: Infinity };
  for (const [name, value] of SPOKES_COLORS) {
    const [pr, pg, pb] = channels(value);
    const distance = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (distance < best.distance) best = { name, distance };
  }
  return best.name;
}
```

- [ ] **Step 4: Run it to see it pass.**

```bash
npx tsx --test src/lib/spokes-palette.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/spokes-palette.json src/lib/spokes-palette.ts src/lib/spokes-palette.test.ts
git commit -m "feat: SPOKES palette module"
```

## Task 3: Palette and contrast tests for `globals.css` (red)

These two tests fail until Task 7. They are committed red on purpose so the PR history shows the failing grader before the change that satisfies it.

**Files:**
- Create: `src/app/globals.palette.test.ts`
- Create: `src/app/globals.contrast.test.ts`

**Interfaces:**
- Consumes: `isPaletteColor` (Task 2); `composite`, `contrastRatio`, `cssTokenValue`, `parseColor`, type `Rgba` from `src/lib/wcag-contrast.ts` (HIG Phase 2).
- Produces: the token names Task 7 must declare in both themes: `--{role}-fill`, `--{role}-on`, `--{role}-soft`, `--{role}-text`, `--{role}-border` for roles `danger`, `success`, `warning`, `info`, `brand-deep`; plus `--on-primary`, `--focus-outline`, `--focus-ring`, `--border-control`, `--progress-edge`.

- [ ] **Step 1: Write the palette test.**

```ts
// src/app/globals.palette.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPaletteColor } from "@/lib/spokes-palette";

/**
 * Every color in globals.css is a SPOKES palette color at some alpha
 * (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md, Design 2.1).
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const LITERAL = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|rgba?\([^)]*\)|(?:hsla?|oklch|oklab|lab|lch)\([^)]*\)/g;
const NAMED = /[\s:(,](black|red|green|blue|yellow|orange|purple|gray|grey|pink|navy|teal|gold|silver|maroon|olive|lime|aqua|fuchsia)(?=[\s,;)])/g;

describe("globals.css palette", () => {
  it("uses only SPOKES palette colors", () => {
    const offenders = [...css.matchAll(LITERAL)].map((m) => m[0]).filter((value) => !isPaletteColor(value));
    assert.deepEqual([...new Set(offenders)], []);
  });

  it("uses no named color other than white and transparent", () => {
    const offenders = [...css.matchAll(NAMED)].map((m) => m[1]);
    assert.deepEqual([...new Set(offenders)], []);
  });
});
```

- [ ] **Step 2: Write the contrast test.**

```ts
// src/app/globals.contrast.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composite, contrastRatio, cssTokenValue, parseColor, type Rgba } from "@/lib/wcag-contrast";

/**
 * Every text and background pair the SPOKES spec names, in both themes, on
 * every ground a component sits on: the page, a card, a card's sheen-lit top,
 * and a muted panel inside a card (the same grounds as
 * globals.badge-contrast.test.ts). Spec: Design 2.2 to 2.7, revised.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ROLES = ["danger", "success", "warning", "info", "brand-deep"] as const;
type Theme = "light" | "dark";

function token(name: string, theme: Theme): string {
  const value = cssTokenValue(css, name, theme);
  assert.ok(value, `${name} is not declared`);
  return value;
}
const toHex = (color: Rgba) => composite({ ...color, a: 1 }, color);
const over = (name: string, theme: Theme, ground: Rgba) => composite(parseColor(token(name, theme)), ground);

function assertOnGrounds(ink: (ground: Rgba) => string, grounds: ReadonlyArray<readonly [string, Rgba]>, floor: number): void {
  const failing = grounds
    .map(([where, ground]) => ({ where, ratio: contrastRatio(ink(ground), toHex(ground)) }))
    .filter(({ ratio }) => ratio < floor)
    .map(({ where, ratio }) => `${where} ${ratio.toFixed(2)}:1`);
  assert.deepEqual(failing, []);
}

for (const theme of ["light", "dark"] as const) {
  describe(`SPOKES contrast, ${theme} theme`, () => {
    const page = parseColor(token("--surface-base", theme));
    const card = parseColor(over("--surface-raised", theme, page));
    const cardTop = parseColor(over("--surface-sheen", theme, card));
    const mutedPanel = parseColor(over("--surface-muted", theme, card));
    const grounds = [["page", page], ["card", card], ["card top", cardTop], ["muted panel", mutedPanel]] as const;

    for (const ink of ["--ink-strong", "--ink-muted", "--ink-faint"]) {
      it(`${ink} clears 4.5:1 on every ground`, () => {
        assertOnGrounds((ground) => over(ink, theme, ground), grounds, 4.5);
      });
    }

    for (const role of ROLES) {
      it(`--${role}-text clears 4.5:1 on every ground`, () => {
        assertOnGrounds((ground) => over(`--${role}-text`, theme, ground), grounds, 4.5);
      });
      it(`--${role}-text clears 4.5:1 on --${role}-soft over every ground`, () => {
        const tinted = grounds.map(([where, ground]) => [where, parseColor(over(`--${role}-soft`, theme, ground))] as const);
        assertOnGrounds((ground) => over(`--${role}-text`, theme, ground), tinted, 4.5);
      });
      it(`--${role}-on clears 4.5:1 on --${role}-fill`, () => {
        const ratio = contrastRatio(token(`--${role}-on`, theme), token(`--${role}-fill`, theme));
        assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
      });
    }

    for (const [ink, fill] of [["--on-accent", "--accent-green"], ["--on-primary", "--primary"], ["--on-error", "--error"]]) {
      it(`${ink} clears 4.5:1 on ${fill}`, () => {
        const ratio = contrastRatio(token(ink, theme), token(fill, theme));
        assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
      });
    }

    for (const edge of ["--focus-outline", "--border-control", "--progress-edge"]) {
      it(`${edge} clears 3:1 on the page, a card, and a muted panel`, () => {
        assertOnGrounds((ground) => over(edge, theme, ground), [grounds[0], grounds[1], grounds[3]], 3);
      });
    }

    it("--chat-error-text clears 4.5:1 on its banner", () => {
      const area = parseColor(token("--chat-area-bg", theme));
      const banner = parseColor(over("--chat-error-bg", theme, area));
      assertOnGrounds((ground) => over("--chat-error-text", theme, ground), [["chat banner", banner]], 4.5);
    });

    it("--toast-celebration-text clears 4.5:1 on its toast", () => {
      const toast = parseColor(over("--toast-celebration-bg", theme, card));
      assertOnGrounds((ground) => over("--toast-celebration-text", theme, ground), [["toast", toast]], 4.5);
    });
  });
}
```

- [ ] **Step 3: Run both to see them fail.**

```bash
npx tsx --test src/app/globals.palette.test.ts src/app/globals.contrast.test.ts 2>&1 | grep -E '^not ok|is not declared|#[0-9a-f]{6}' | head -20
```

Expected: the palette test lists off-palette values such as `#4a4d54`, `#f3f7f8`, `#c43c3c`, `rgba(18, 38, 63, 0.05)`, and the named `black`. The contrast test fails with `--danger-text is not declared`, `--on-primary is not declared`, `--focus-outline is not declared`, and similar. Save this output; the PR description quotes it.

- [ ] **Step 4: Commit the red tests.**

```bash
git add src/app/globals.palette.test.ts src/app/globals.contrast.test.ts
git commit -m "test: palette and contrast graders for SPOKES tokens (red until the token rewrite)"
```

## Task 4: Tailwind role-utility test (red)

**Files:**
- Modify: `package.json`, `package-lock.json` (add `@tailwindcss/node`)
- Create: `src/app/globals.theme-utilities.test.ts`

**Interfaces:**
- Produces: the utility contract Task 7's `@theme inline` must satisfy, and that Tasks 5, 14, and 15 rewrite classes onto: `bg-{role}`, `bg-{role}-soft`, `text-{role}`, `text-on-{role}`, `border-{role}`, `ring-{role}`, `bg-surface-muted`, `border-line`, `text-ink-strong`, `text-ink-muted`.

- [ ] **Step 1: Add the compiler as a direct dependency,** pinned to the version `@tailwindcss/postcss` already resolved, so the test never relies on hoisting. Network access is needed, so use the Terminal panel if the sandbox refuses.

```bash
npm install "@tailwindcss/node@$(node -p "require('./node_modules/@tailwindcss/postcss/package.json').version")"
grep -n '"@tailwindcss/node"' package.json
```

Expected: one line in `dependencies` (this repo keeps everything there; Render skips devDependencies).

- [ ] **Step 2: Write the failing test.**

```ts
// src/app/globals.theme-utilities.test.ts
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@tailwindcss/node";

/**
 * Compiles globals.css with the installed Tailwind and checks what each role
 * utility actually paints. Tailwind 4 reads --text-color-*, --border-color-*,
 * --ring-color-* and the other per-property namespaces before --color-*, so
 * one role name gives text, fill, and border their own values. A Tailwind
 * upgrade that changes that lookup fails here, not in production.
 */
const ROLES = ["danger", "success", "warning", "info", "brand-deep"] as const;
const SIZES: ReadonlyArray<readonly [string, string]> = [
  ["xs", "0.8125rem"], ["sm", "0.9375rem"], ["base", "1.0625rem"], ["lg", "1.1rem"], ["xl", "1.375rem"],
  ["2xl", "1.75rem"], ["3xl", "2.125rem"], ["4xl", "2.5rem"], ["5xl", "3.5rem"],
];
const RADII: ReadonlyArray<readonly [string, string]> = [["sm", "6px"], ["md", "8px"], ["lg", "12px"], ["xl", "16px"], ["2xl", "20px"], ["3xl", "24px"]];

const roleClasses = ROLES.flatMap((role) => [`bg-${role}`, `bg-${role}-soft`, `text-${role}`, `text-on-${role}`, `border-${role}`, `ring-${role}`]);
const candidates = [
  ...roleClasses, "bg-danger/10", "bg-surface-muted", "border-line", "text-ink-strong", "text-ink-muted",
  ...SIZES.map(([size]) => `text-${size}`), ...RADII.map(([step]) => `rounded-${step}`),
];

let built = "";
before(async () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const compiler = await compile(css, { base: join(process.cwd(), "src/app"), onDependency: () => {} });
  built = compiler.build(candidates);
});

function rule(className: string): string {
  const selector = `.${className.replace(/[/:[\]().]/g, (c) => `\\${c}`)} {`;
  const start = built.indexOf(selector);
  assert.ok(start >= 0, `${className} generated no rule`);
  return built.slice(start, built.indexOf("}", start));
}

describe("SPOKES role utilities", () => {
  for (const role of ROLES) {
    it(`${role} paints fill, tint, text, ink, border, and ring from its own tokens`, () => {
      assert.match(rule(`bg-${role}`), new RegExp(`background-color: var\\(--${role}-fill\\)`));
      assert.match(rule(`bg-${role}-soft`), new RegExp(`background-color: var\\(--${role}-soft\\)`));
      assert.match(rule(`text-${role}`), new RegExp(`color: var\\(--${role}-text\\)`));
      assert.match(rule(`text-on-${role}`), new RegExp(`color: var\\(--${role}-on\\)`));
      assert.match(rule(`border-${role}`), new RegExp(`border-color: var\\(--${role}-border\\)`));
      assert.match(rule(`ring-${role}`), new RegExp(`--tw-ring-color: var\\(--${role}-border\\)`));
    });
  }

  it("keeps opacity modifiers working", () => {
    assert.match(rule("bg-danger/10"), /color-mix\(in oklab, var\(--danger-fill\) 10%, transparent\)/);
  });

  it("maps neutral helpers onto surface, line, and ink tokens", () => {
    assert.match(rule("bg-surface-muted"), /background-color: var\(--surface-muted\)/);
    assert.match(rule("border-line"), /border-color: var\(--border\)/);
    assert.match(rule("text-ink-strong"), /color: var\(--ink-strong\)/);
    assert.match(rule("text-ink-muted"), /color: var\(--ink-muted\)/);
  });
});

describe("SPOKES type scale and corners", () => {
  for (const [size, value] of SIZES) {
    it(`text-${size} is ${value}`, () => assert.match(rule(`text-${size}`), new RegExp(`font-size: ${value.replace(".", "\\.")}`)));
  }
  for (const [step, value] of RADII) {
    it(`rounded-${step} is ${value}`, () => assert.match(rule(`rounded-${step}`), new RegExp(`border-radius: ${value}`)));
  }
});
```

- [ ] **Step 3: Run it to see it fail.**

```bash
npx tsx --test src/app/globals.theme-utilities.test.ts 2>&1 | grep -E '^not ok|generated no rule' | head -8
```

Expected: FAIL, `bg-danger generated no rule` and `text-xs` reporting `0.75rem`.

- [ ] **Step 4: Commit the red test.**

```bash
git add package.json package-lock.json src/app/globals.theme-utilities.test.ts
git commit -m "test: role utilities, type scale, and corners compile to SPOKES tokens (red until the token rewrite)"
```

## Task 5: Class-mapping module

**Files:**
- Create: `scripts/lib/spokes-class-map.mjs`
- Test: `src/lib/spokes-class-map.test.ts` (runs in `npm test`, same import style as `src/lib/percentile.test.ts`)

**Interfaces:**
- Produces: `HUES: string` (regex alternation), `ALL_RULES: readonly string[]` = `["hue", "token-text", "display-family", "radius", "small-text", "display-weight"]`, `mapClass(token: string): null | { rule: string, to: string | null } | { rule: string, review: string }`, `rewriteClassList(classList: string, rules?: readonly string[]): { output: string, changes: Array<{ from: string, to: string | null }>, review: Array<{ token: string, reason: string }> }`.

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/spokes-class-map.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapClass, rewriteClassList } from "../../scripts/lib/spokes-class-map.mjs";

const to = (token: string) => {
  const result = mapClass(token);
  return result && "to" in result ? result.to : result;
};

describe("hue classes become SPOKES roles", () => {
  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ["bg-red-50", "bg-danger-soft"],
    ["bg-red-600", "bg-danger"],
    ["text-emerald-700", "text-success"],
    ["border-amber-300", "border-warning"],
    ["border-l-red-500", "border-l-danger"],
    ["hover:bg-blue-700", "hover:bg-info"],
    ["bg-red-500/10", "bg-danger/10"],
    ["from-sky-100", "from-info-soft"],
    ["bg-indigo-50", "bg-brand-deep-soft"],
    ["ring-teal-400", "ring-info"],
    ["fill-orange-500", "fill-warning"],
    ["dark:bg-red-950/40", null],
    ["text-gray-500", "text-ink-muted"],
    ["text-slate-900", "text-ink-strong"],
    ["bg-gray-100", "bg-surface-muted"],
    ["border-gray-200", "border-line"],
  ];
  for (const [input, expected] of cases) it(`${input} -> ${expected}`, () => assert.equal(to(input), expected));

  it("sends text with opacity, placeholder hues, and odd neutrals to review", () => {
    for (const token of ["text-red-600/80", "placeholder-gray-400", "bg-gray-700"]) {
      const result = mapClass(token);
      assert.ok(result && "review" in result, token);
    }
  });
});

describe("token text, display family, corners, and small text", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["text-[var(--error)]", "text-danger"],
    ["text-[var(--accent-green)]", "text-success"],
    ["hover:text-[var(--primary)]", "hover:text-info"],
    ["text-accent-gold", "text-warning"],
    ["font-[family-name:var(--font-display)]", "font-display"],
    ["rounded-[1rem]", "rounded-xl"],
    ["rounded-[1.2rem]", "rounded-2xl"],
    ["rounded-t-[1.4rem]", "rounded-t-3xl"],
    ["rounded-[0.85rem]", "rounded-lg"],
    ["rounded-[2rem]", "rounded-3xl"],
    ["text-[0.65rem]", "text-xs"],
    ["text-[11px]", "text-xs"],
  ];
  for (const [input, expected] of cases) it(`${input} -> ${expected}`, () => assert.equal(to(input), expected));

  it("leaves text sizes at or above 13px and unrelated classes alone", () => {
    for (const token of ["text-[15px]", "text-[13px]", "px-4", "bg-[var(--surface-raised)]", "text-danger"]) {
      assert.equal(mapClass(token), null, token);
    }
  });
});

describe("rewriteClassList", () => {
  it("drops a heavy weight only when the list uses the display font", () => {
    assert.equal(rewriteClassList("font-display text-2xl font-bold").output, "font-display text-2xl");
    assert.equal(rewriteClassList("font-bold text-lg").output, "font-bold text-lg");
  });

  it("keeps leading and trailing whitespace for template pieces", () => {
    assert.equal(rewriteClassList(" bg-red-50 ").output, " bg-danger-soft ");
  });

  it("returns the input unchanged when nothing maps", () => {
    const input = "px-4  py-2\n  rounded";
    assert.equal(rewriteClassList(input).output, input);
  });

  it("applies only the requested rules", () => {
    assert.equal(rewriteClassList("bg-red-50 text-[var(--error)]", ["token-text"]).output, "bg-red-50 text-danger");
  });

  it("flags a hue it cannot parse instead of skipping it", () => {
    const result = rewriteClassList("data-[state=open]:bg-red-50");
    assert.equal(result.output, "data-[state=open]:bg-red-50");
    assert.equal(result.review.length, 1);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

```bash
npx tsx --test src/lib/spokes-class-map.test.ts
```

Expected: FAIL, `Cannot find module '../../scripts/lib/spokes-class-map.mjs'`.

- [ ] **Step 3: Write the module.**

```js
// scripts/lib/spokes-class-map.mjs
/**
 * Maps one Tailwind class onto the SPOKES role utilities defined in
 * src/app/globals.css (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md,
 * Design 5.1). Pure: no I/O. scripts/lib/spokes-source-rewrite.mjs applies it to files.
 */
export const HUES = "red|rose|pink|fuchsia|emerald|green|lime|amber|yellow|orange|blue|sky|cyan|teal|indigo|violet|purple|slate|gray|zinc|neutral|stone";
export const ALL_RULES = Object.freeze(["hue", "token-text", "display-family", "radius", "small-text", "display-weight"]);

const ROLE_BY_HUE = Object.freeze({
  red: "danger", rose: "danger", pink: "danger", fuchsia: "danger",
  emerald: "success", green: "success", lime: "success",
  amber: "warning", yellow: "warning", orange: "warning",
  blue: "info", sky: "info", cyan: "info", teal: "info",
  indigo: "brand-deep", violet: "brand-deep", purple: "brand-deep",
});
// Tokens used as both text and fill. Their dark values are fills, so text uses the role instead.
const TOKEN_TEXT_ROLE = Object.freeze({
  "--error": "danger", "--accent-red": "danger", "--success": "success", "--accent-green": "success",
  "--accent-blue": "info", "--primary": "info", "--accent-gold": "warning",
});
const NAMED_TEXT_ROLE = Object.freeze({ "accent-red": "danger", "accent-green": "success", "accent-blue": "info", "accent-gold": "warning" });
const RADIUS_STEPS = Object.freeze([["sm", 6], ["md", 8], ["lg", 12], ["xl", 16], ["2xl", 20], ["3xl", 24]]);
const SOFT_PREFIXES = new Set(["bg", "from", "via", "to"]);
const LINE_PREFIX = /^(border(?:-[xytrbl])?|ring|outline|divide)$/;
const HEAVY = new Set(["font-semibold", "font-bold", "font-extrabold", "font-black"]);
const DISPLAY_FAMILY = "font-[family-name:var(--font-display)]";

const V = "((?:[a-z0-9-]+:)*)";
const HUE_RE = new RegExp(`^${V}(bg|text|border(?:-[xytrbl])?|from|via|to|ring|fill|stroke|outline|divide|decoration|accent|caret|placeholder|shadow)-(${HUES})-(\\d{2,3})(\\/\\d{1,3})?$`);
const TOKEN_TEXT_RE = new RegExp(`^${V}text-\\[var\\((--[a-z-]+)\\)\\]$`);
const NAMED_TEXT_RE = new RegExp(`^${V}text-(accent-red|accent-green|accent-blue|accent-gold)(\\/\\d{1,3})?$`);
const RADIUS_RE = new RegExp(`^${V}rounded(-(?:tl|tr|bl|br|ss|se|es|ee|[trblse]))?-\\[(\\d*\\.?\\d+)(rem|px)\\]$`);
const SMALL_TEXT_RE = new RegExp(`^${V}text-\\[(\\d*\\.?\\d+)(rem|px)\\]$`);
const HUE_ANYWHERE = new RegExp(`-(?:${HUES})-\\d{2,3}`);

const toPx = (value, unit) => Number(value) * (unit === "rem" ? 16 : 1);
const OPACITY_TEXT = "text color with opacity loses contrast; pick a solid role";

function nearestRadius(px) {
  let best = RADIUS_STEPS[0];
  for (const step of RADIUS_STEPS) if (Math.abs(step[1] - px) <= Math.abs(best[1] - px)) best = step;
  return best[0];
}

function mapNeutral(variants, prefix, shade, opacity) {
  if (prefix === "text" && !opacity && shade >= 700) return { rule: "hue", to: `${variants}text-ink-strong` };
  if (prefix === "text" && !opacity && shade >= 400) return { rule: "hue", to: `${variants}text-ink-muted` };
  if (prefix === "bg" && shade <= 200) return { rule: "hue", to: `${variants}bg-surface-muted${opacity}` };
  if (LINE_PREFIX.test(prefix)) return { rule: "hue", to: `${variants}${prefix}-line${opacity}` };
  return { rule: "hue", review: `no SPOKES neutral for ${prefix}-${shade}; choose an ink or surface token` };
}

function mapHue([, variants, prefix, hue, shadeText, opacity = ""]) {
  if (variants.split(":").includes("dark")) return { rule: "hue", to: null }; // role tokens already switch per theme
  const shade = Number(shadeText);
  const role = ROLE_BY_HUE[hue];
  if (!role) return mapNeutral(variants, prefix, shade, opacity);
  if (prefix === "placeholder") return { rule: "hue", review: "placeholder text needs a contrast check; use placeholder:text-ink-faint" };
  if (prefix === "text" && opacity) return { rule: "hue", review: OPACITY_TEXT };
  const soft = SOFT_PREFIXES.has(prefix) && shade <= 200 ? "-soft" : "";
  return { rule: "hue", to: `${variants}${prefix}-${role}${soft}${opacity}` };
}

function mapDisplayFamily(token) {
  if (!token.endsWith(DISPLAY_FAMILY)) return null;
  const variants = token.slice(0, -DISPLAY_FAMILY.length);
  return variants === "" || variants.endsWith(":") ? { rule: "display-family", to: `${variants}font-display` } : null;
}

/** Maps one class. null means "not ours"; `to: null` means "delete it". */
export function mapClass(token) {
  const hue = token.match(HUE_RE);
  if (hue) return mapHue(hue);
  const tokenText = token.match(TOKEN_TEXT_RE);
  if (tokenText && TOKEN_TEXT_ROLE[tokenText[2]]) return { rule: "token-text", to: `${tokenText[1]}text-${TOKEN_TEXT_ROLE[tokenText[2]]}` };
  const namedText = token.match(NAMED_TEXT_RE);
  if (namedText) return namedText[3] ? { rule: "token-text", review: OPACITY_TEXT } : { rule: "token-text", to: `${namedText[1]}text-${NAMED_TEXT_ROLE[namedText[2]]}` };
  const family = mapDisplayFamily(token);
  if (family) return family;
  const radius = token.match(RADIUS_RE);
  if (radius) return { rule: "radius", to: `${radius[1]}rounded${radius[2] ?? ""}-${nearestRadius(toPx(radius[3], radius[4]))}` };
  const small = token.match(SMALL_TEXT_RE);
  if (small && toPx(small[2], small[3]) < 13) return { rule: "small-text", to: `${small[1]}text-xs` };
  return null;
}

function classify(token, usesDisplay, enabled) {
  if (usesDisplay && HEAVY.has(token)) return enabled.has("display-weight") ? { to: null } : {};
  const mapped = mapClass(token);
  if (mapped && enabled.has(mapped.rule)) return "review" in mapped ? { review: mapped.review } : { to: mapped.to };
  if (!mapped && enabled.has("hue") && HUE_ANYWHERE.test(token)) return { review: "unrecognized variant around an off-palette hue" };
  return {};
}

/** Rewrites a whitespace-separated class list. Untouched input comes back byte for byte. */
export function rewriteClassList(classList, rules = ALL_RULES) {
  const enabled = new Set(rules);
  const core = classList.trim();
  if (!core) return { output: classList, changes: [], review: [] };
  const tokens = core.split(/\s+/);
  const usesDisplay = tokens.some((t) => t === "font-display" || t.endsWith(DISPLAY_FAMILY));
  const changes = [];
  const review = [];
  const kept = [];
  for (const token of tokens) {
    const result = classify(token, usesDisplay, enabled);
    if (result.review) review.push({ token, reason: result.review });
    if (result.to === undefined) {
      kept.push(token);
      continue;
    }
    changes.push({ from: token, to: result.to });
    if (result.to !== null) kept.push(result.to);
  }
  if (changes.length === 0) return { output: classList, changes, review };
  const leading = classList.slice(0, classList.length - classList.trimStart().length);
  const trailing = classList.slice(classList.trimEnd().length);
  return { output: `${leading}${kept.join(" ")}${trailing}`, changes, review };
}
```

- [ ] **Step 4: Run it to see it pass.**

```bash
npx tsx --test src/lib/spokes-class-map.test.ts
```

Expected: PASS, every case.

- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/spokes-class-map.mjs src/lib/spokes-class-map.test.ts
git commit -m "feat: map Tailwind classes onto SPOKES role utilities"
```

## Task 6: Source rewriter and sweep CLI

**Files:**
- Create: `scripts/lib/spokes-source-rewrite.mjs`
- Create: `scripts/spokes-class-sweep.mjs`
- Test: `src/lib/spokes-source-rewrite.test.ts`

**Interfaces:**
- Consumes: `rewriteClassList`, `ALL_RULES`, `HUES` (Task 5).
- Produces: `rewriteSource(source: string, fileName: string, rules?: readonly string[]): { output: string, changes: Array<{ line: number, from: string, to: string | null }>, review: Array<{ line: number, token: string, reason: string }> }`; CLI `node scripts/spokes-class-sweep.mjs --paths=<glob>[,<glob>...] [--rules=<rule>[,<rule>...]] [--write]`.

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/spokes-source-rewrite.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteSource } from "../../scripts/lib/spokes-source-rewrite.mjs";

describe("rewriteSource", () => {
  it("rewrites a JSX className", () => {
    const { output } = rewriteSource('const a = <p className="px-2 text-red-600">Oops</p>;', "x.tsx");
    assert.equal(output, 'const a = <p className="px-2 text-danger">Oops</p>;');
  });

  it("rewrites clsx object keys", () => {
    const { output } = rewriteSource('cn({ "bg-red-50": isError, "px-2": true });', "x.ts");
    assert.equal(output, 'cn({ "bg-danger-soft": isError, "px-2": true });');
  });

  it("rewrites the static pieces of a template literal", () => {
    const { output } = rewriteSource("const c = `px-2 ${size} bg-red-50`;", "x.ts");
    assert.equal(output, "const c = `px-2 ${size} bg-danger-soft`;");
  });

  it("lists a class built from a template expression for review", () => {
    const { output, review } = rewriteSource("const c = `bg-${tone}-100`;", "x.ts");
    assert.equal(output, "const c = `bg-${tone}-100`;");
    assert.equal(review.length, 1);
    assert.match(review[0].reason, /template expression/);
  });

  it("leaves prose alone", () => {
    const source = 'const t = "Use the red pen on page 500";';
    assert.equal(rewriteSource(source, "x.ts").output, source);
  });

  it("reports one-based line numbers", () => {
    const { changes } = rewriteSource('const a = 1;\nconst b = "bg-red-50";', "x.ts");
    assert.deepEqual(changes, [{ line: 2, from: "bg-red-50", to: "bg-danger-soft" }]);
  });

  it("applies only the requested rules", () => {
    const { output } = rewriteSource('const a = "bg-red-50 text-[var(--error)]";', "x.ts", ["token-text"]);
    assert.equal(output, 'const a = "bg-red-50 text-danger";');
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

```bash
npx tsx --test src/lib/spokes-source-rewrite.test.ts
```

Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Write the rewriter.**

```js
// scripts/lib/spokes-source-rewrite.mjs
/**
 * Applies rewriteClassList to every string literal and template-literal piece
 * in a .ts or .tsx file, found through the TypeScript AST so object keys and
 * template pieces are covered. Class names assembled from template expressions
 * cannot be mapped safely and are returned for hand review.
 */
import ts from "typescript";
import { ALL_RULES, HUES, rewriteClassList } from "./spokes-class-map.mjs";

const TEMPLATE_BUILT = [
  /(?:^|[\s"'`:])(?:bg|text|border|ring|fill|stroke|from|via|to)-$/,
  new RegExp(`-(?:${HUES})-$`),
];

export function rewriteSource(source, fileName, rules = ALL_RULES) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const edits = [];
  const changes = [];
  const review = [];
  const lineOf = (pos) => file.getLineAndCharacterOfPosition(pos).line + 1;

  function handle(start, end, isTemplatePiece) {
    const raw = source.slice(start, end);
    const line = lineOf(start);
    if (isTemplatePiece && TEMPLATE_BUILT.some((re) => re.test(raw))) {
      review.push({ line, token: raw.trim().slice(-40), reason: "class name built from a template expression" });
    }
    const result = rewriteClassList(raw, rules);
    for (const change of result.changes) changes.push({ line, ...change });
    for (const item of result.review) review.push({ line, ...item });
    if (result.output !== raw) edits.push({ start, end, text: result.output });
  }

  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) handle(node.getStart(file) + 1, node.getEnd() - 1, false);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) handle(node.getStart(file) + 1, node.getEnd() - 2, true);
    else if (ts.isTemplateTail(node)) handle(node.getStart(file) + 1, node.getEnd() - 1, true);
    ts.forEachChild(node, visit);
  }

  visit(file);
  const output = [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
  return { output, changes, review };
}
```

- [ ] **Step 4: Write the CLI.**

```js
// scripts/spokes-class-sweep.mjs
// node scripts/spokes-class-sweep.mjs --paths=<glob>[,<glob>...] [--rules=<rule>,...] [--write]
// Dry run by default: prints every change and every item that needs a hand fix.
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { ALL_RULES } from "./lib/spokes-class-map.mjs";
import { rewriteSource } from "./lib/spokes-source-rewrite.mjs";

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const paths = option("paths");
if (!paths) {
  console.error("usage: node scripts/spokes-class-sweep.mjs --paths=<glob>[,<glob>...] [--rules=<rule>,...] [--write]");
  process.exit(2);
}
const rules = option("rules")?.split(",") ?? ALL_RULES;
const unknown = rules.filter((rule) => !ALL_RULES.includes(rule));
if (unknown.length > 0) {
  console.error(`unknown rule(s): ${unknown.join(", ")}; known: ${ALL_RULES.join(", ")}`);
  process.exit(2);
}
const write = args.includes("--write");
const files = [...new Set(paths.split(",").flatMap((glob) => globSync(glob)))]
  .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file))
  .sort();

let rewritten = 0;
let reviewCount = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const result = rewriteSource(source, file, rules);
  for (const c of result.changes) console.log(`${file}:${c.line}  ${c.from} -> ${c.to ?? "(removed)"}`);
  for (const r of result.review) console.log(`REVIEW ${file}:${r.line}  ${r.token}  (${r.reason})`);
  reviewCount += result.review.length;
  if (result.output === source) continue;
  rewritten += 1;
  if (write) writeFileSync(file, result.output);
}
console.log(`${write ? "rewrote" : "would rewrite"} ${rewritten} of ${files.length} file(s); ${reviewCount} item(s) need a hand fix`);
```

- [ ] **Step 5: Run the tests and a dry run.**

```bash
npx tsx --test src/lib/spokes-source-rewrite.test.ts
node scripts/spokes-class-sweep.mjs --paths='src/components/ui/*.tsx' | tail -1
```

Expected: tests PASS; the dry run prints `would rewrite N of M file(s)` and changes nothing (`git status --short src/components/ui` is empty).

- [ ] **Step 6: Commit.**

```bash
git add scripts/lib/spokes-source-rewrite.mjs scripts/spokes-class-sweep.mjs src/lib/spokes-source-rewrite.test.ts
git commit -m "feat: sweep CLI that rewrites class strings onto SPOKES roles"
```

## Task 7: Rewrite `globals.css` on SPOKES values

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx:32-33` (`themeColor`)
- Modify: `src/app/globals.primary-button.test.ts` (ink token name; accept a solid fill)
- Create: `src/app/globals.motion.test.ts`

**Interfaces:**
- Consumes: the token and utility contracts from Tasks 3 and 4.
- Produces: every token in those contracts, plus `--accent-text`, `--glow-primary`, `--grad-progress`, `--program-ietp-border`, and the `@layer components` rule for `.font-display`.

- [ ] **Step 1: Write the failing motion test.**

```ts
// src/app/globals.motion.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** SPOKES motion stays off for people who ask for reduced motion (spec Design 4). */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

describe("reduced motion", () => {
  it("still zeroes every transition and animation", () => {
    assert.match(reduced, /transition-duration: 0\.01ms !important/);
    assert.match(reduced, /animation-duration: 0\.01ms !important/);
  });

  it("cancels the hover lifts, not just their animation", () => {
    for (const selector of [".primary-button:hover", ".surface-section:hover"]) {
      const at = reduced.indexOf(selector);
      assert.ok(at >= 0, `${selector} missing from the reduced-motion block`);
      assert.match(reduced.slice(at, reduced.indexOf("}", at)), /transform: none/);
    }
  });
});
```

```bash
npx tsx --test src/app/globals.motion.test.ts
```

Expected: FAIL, `.primary-button:hover missing from the reduced-motion block`.

- [ ] **Step 2: Replace the light token block.** Replace everything from `:root,` / `[data-theme="light"] {` through its closing `}` with:

```css
:root,
[data-theme="light"] {
  /* Native form controls render with light-mode system colors. */
  color-scheme: light;

  /* SPOKES palette (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md,
     Design 2.1). globals.palette.test.ts fails on any other color in this file. */
  --primary: #007baf;
  --accent: #37b550;
  --dark: #004071;
  --light: #ffffff;
  --muted: #edf3f7;
  --gray: #60636b;
  --gold: #d3b257;
  --royal: #00133f;
  --mauve: #a7253f;
  --offwhite: #d1d3d4;
  --muted-gold: #ad8806;
  --accent-text: #1e7a2e;

  /* Surfaces and ink */
  --surface-base: #edf3f7;
  --surface-raised: #ffffff;
  --surface-soft: #ffffff;
  --surface-muted: rgba(0, 64, 113, 0.05);
  --surface-interactive: rgba(0, 64, 113, 0.08);
  --surface-interactive-hover: rgba(0, 64, 113, 0.12);
  --surface-overlay: rgba(0, 64, 113, 0.04);
  --surface-sheen: rgba(255, 255, 255, 0.72);
  --ink-strong: #004071;
  --ink-muted: #60636b;
  /* Carries text (HIG Phase 2 measured it), so it clears 4.5:1 on every ground. */
  --ink-faint: rgba(0, 64, 113, 0.75);
  --border: #d1d3d4;
  --border-strong: rgba(0, 64, 113, 0.16);
  /* Inputs, checkboxes, toggles: 3:1 or better on the page and on cards. */
  --border-control: #60636b;
  --border-luminous: rgba(255, 255, 255, 0.82);

  /* Fills and the ink that sits on them */
  --accent-green: #1e7a2e;
  --on-accent: #ffffff;
  --on-primary: #ffffff;
  --accent-blue: #007baf;
  --accent-gold: #ad8806;
  --accent-red: #a7253f;
  --error: #a7253f;
  --on-error: #ffffff;
  --success: #1e7a2e;
  --glow-green: rgba(55, 181, 80, 0.15);
  --glow-gold: rgba(211, 178, 87, 0.1);
  --glow-primary: rgba(0, 123, 175, 0.35);

  /* Roles: fill, ink on fill, soft tint, text, border (spec Design 2.4, revised) */
  --danger-fill: #a7253f;
  --danger-on: #ffffff;
  --danger-soft: rgba(167, 37, 63, 0.1);
  --danger-text: #a7253f;
  --danger-border: #a7253f;
  --success-fill: #1e7a2e;
  --success-on: #ffffff;
  /* 8%, not 12%: accent-text measures 4.52:1 on this tint over the muted page; 12% fell to 4.37:1. */
  --success-soft: rgba(55, 181, 80, 0.08);
  --success-text: #1e7a2e;
  --success-border: #37b550;
  --warning-fill: #d3b257;
  --warning-on: #004071;
  --warning-soft: rgba(211, 178, 87, 0.25);
  --warning-text: #004071;
  --warning-border: #d3b257;
  --info-fill: #007baf;
  --info-on: #ffffff;
  --info-soft: rgba(0, 123, 175, 0.1);
  --info-text: #004071;
  --info-border: #007baf;
  --brand-deep-fill: #00133f;
  --brand-deep-on: #ffffff;
  --brand-deep-soft: rgba(0, 19, 63, 0.08);
  --brand-deep-text: #00133f;
  --brand-deep-border: #00133f;

  /* Focus (spec Design 2.7, approved exception) and progress-bar edge (Design 7, revised) */
  --focus-outline: #004071;
  --focus-ring: rgba(211, 178, 87, 0.55);
  --progress-edge: #004071;
  --grad-progress: linear-gradient(90deg, var(--primary) 0%, var(--gold) 100%);

  /* Elevation: navy-tinted SPOKES shadows. SPOKES shadow-hover is black at 15%;
     royal at the same alpha keeps the palette test free of exceptions. */
  --shadow-card: 0 4px 15px rgba(0, 64, 113, 0.08);
  --shadow-card-lg: 0 8px 32px rgba(0, 64, 113, 0.08);
  --shadow-premium: 0 18px 50px -12px rgba(0, 19, 63, 0.35);
  --shadow-premium-hover: 0 10px 30px rgba(0, 19, 63, 0.15);
  /* Solid muted: SPOKES --grad-slide-bg ends in offwhite, where gray body text is 4.0:1. */
  --app-background: #edf3f7;

  /* Status badges (globals.badge-contrast.test.ts) */
  --badge-success-bg: rgba(55, 181, 80, 0.08);
  --badge-success-text: #1e7a2e;
  --badge-warning-bg: rgba(211, 178, 87, 0.25);
  --badge-warning-text: #004071;
  --badge-error-bg: rgba(167, 37, 63, 0.1);
  --badge-error-text: #a7253f;
  --badge-info-bg: rgba(0, 123, 175, 0.1);
  --badge-info-text: #004071;
  --toast-celebration-bg: rgba(211, 178, 87, 0.25);
  --toast-celebration-border: rgba(211, 178, 87, 0.6);
  --toast-celebration-text: #004071;
  --urgency-critical-bg: rgba(167, 37, 63, 0.1);
  --urgency-critical-text: #a7253f;
  --urgency-high-bg: rgba(211, 178, 87, 0.25);
  --urgency-high-text: #004071;
  --urgency-medium-bg: rgba(0, 123, 175, 0.1);
  --urgency-medium-text: #004071;
  --program-spokes-bg: rgba(0, 123, 175, 0.1);
  --program-spokes-text: #004071;
  --program-ae-bg: rgba(0, 19, 63, 0.08);
  --program-ae-text: #00133f;
  /* IETP is an outlined pill, so it differs from the two filled badges without color. */
  --program-ietp-bg: rgba(255, 255, 255, 0);
  --program-ietp-text: #004071;
  --program-ietp-border: #ad8806;

  /* Legacy aliases */
  --background: var(--surface-base);
  --foreground: var(--ink-strong);
  --surface: var(--surface-raised);
  --surface-strong: #ffffff;
  --surface-dark: rgba(0, 64, 113, 0.88);
  --accent-strong: var(--accent-green);
  --accent-secondary: var(--accent-blue);
  --accent-tertiary: var(--accent-gold);

  /* Chat */
  --chat-bubble-assistant-bg: transparent;
  --chat-bubble-assistant-border: transparent;
  --chat-bubble-user-bg: #1e7a2e;
  --chat-bubble-user-avatar: #1e7a2e;
  --chat-sage-mark: #007baf;
  --chat-sage-action: #004071;
  --chat-sage-mark-bg: rgba(0, 123, 175, 0.12);
  --chat-panel-bg: #ffffff;
  --chat-panel-border: #d1d3d4;
  --chat-input-bg: transparent;
  --chat-input-border: #60636b;
  --chat-area-bg: #ffffff;
  --chat-header-bg: rgba(255, 255, 255, 0.82);
  --chat-sidebar-bg: #edf3f7;
  --chat-sidebar-active: rgba(0, 123, 175, 0.12);
  --chat-sidebar-hover: rgba(0, 64, 113, 0.06);
  --chat-typing-dot: var(--ink-muted);
  --chat-error-bg: rgba(211, 178, 87, 0.25);
  --chat-error-border: #d3b257;
  --chat-error-text: #004071;
  --chat-composer-focus: rgba(0, 123, 175, 0.22);

  /* Motion: SPOKES dur-* and ease-* (spec Design 4) */
  --ease-smooth: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-spring: cubic-bezier(0.68, -0.55, 0.265, 1.55);
  --ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
  --duration-fast: 200ms;
  --duration-normal: 300ms;
  --duration-slow: 800ms;
  --stagger-gap: 120ms;

  /* Ruled note card */
  --paper-bg: #ffffff;
  --paper-line: rgba(0, 123, 175, 0.06);
  --paper-margin: rgba(167, 37, 63, 0.2);
}
```

- [ ] **Step 3: Replace the dark token block** (`[data-theme="dark"] { ... }`, the first one, directly after the light block):

```css
[data-theme="dark"] {
  /* Without this, native <select> option lists render light-mode text on the dark page. */
  color-scheme: dark;

  --surface-base: #00133f;
  --surface-raised: #004071;
  --surface-soft: #004071;
  --surface-muted: rgba(255, 255, 255, 0.05);
  --surface-interactive: rgba(255, 255, 255, 0.08);
  --surface-interactive-hover: rgba(255, 255, 255, 0.12);
  --surface-overlay: rgba(255, 255, 255, 0.1);
  --surface-sheen: rgba(255, 255, 255, 0.04);
  --ink-strong: #ffffff;
  --ink-muted: rgba(255, 255, 255, 0.75);
  /* 0.65, not 0.6: 0.6 measured 4.35:1 on a muted panel inside a card. */
  --ink-faint: rgba(255, 255, 255, 0.65);
  --border: rgba(255, 255, 255, 0.12);
  --border-strong: rgba(255, 255, 255, 0.16);
  --border-control: rgba(255, 255, 255, 0.6);
  --border-luminous: rgba(255, 255, 255, 0.18);

  --accent-green: #1e7a2e;
  --on-accent: #ffffff;
  --on-primary: #ffffff;
  --accent-blue: #007baf;
  --accent-gold: #d3b257;
  --accent-red: #a7253f;
  --error: #a7253f;
  --on-error: #ffffff;
  --success: #1e7a2e;
  --glow-green: rgba(55, 181, 80, 0.25);
  --glow-gold: rgba(211, 178, 87, 0.2);
  --glow-primary: rgba(0, 123, 175, 0.45);

  /* Roles. No SPOKES red, green, or blue clears 4.5:1 as text on navy (mauve is
     about 1.5:1), so role text is white and the hue rides on fills, dots, and borders. */
  --danger-fill: #a7253f;
  --danger-on: #ffffff;
  --danger-soft: rgba(167, 37, 63, 0.35);
  --danger-text: #ffffff;
  --danger-border: #a7253f;
  --success-fill: #1e7a2e;
  --success-on: #ffffff;
  --success-soft: rgba(55, 181, 80, 0.2);
  --success-text: #ffffff;
  --success-border: #37b550;
  --warning-fill: #d3b257;
  --warning-on: #004071;
  --warning-soft: rgba(211, 178, 87, 0.2);
  /* White, not gold: gold on its own tint over a navy card is about 3.8:1. */
  --warning-text: #ffffff;
  --warning-border: #d3b257;
  --info-fill: #007baf;
  --info-on: #ffffff;
  --info-soft: rgba(0, 123, 175, 0.3);
  --info-text: #ffffff;
  --info-border: #007baf;
  --brand-deep-fill: #ffffff;
  --brand-deep-on: #00133f;
  --brand-deep-soft: rgba(255, 255, 255, 0.1);
  --brand-deep-text: #ffffff;
  --brand-deep-border: rgba(255, 255, 255, 0.6);

  --focus-outline: #d3b257;
  --focus-ring: rgba(211, 178, 87, 0);
  --progress-edge: #d3b257;

  --shadow-card: 0 4px 15px rgba(0, 19, 63, 0.6);
  --shadow-card-lg: 0 8px 32px rgba(0, 19, 63, 0.6);
  --shadow-premium: 0 18px 50px -12px rgba(0, 19, 63, 0.8);
  --shadow-premium-hover: 0 10px 30px rgba(0, 19, 63, 0.7);
  --app-background: #00133f;

  --badge-success-bg: rgba(55, 181, 80, 0.2);
  --badge-success-text: #ffffff;
  --badge-warning-bg: rgba(211, 178, 87, 0.2);
  --badge-warning-text: #ffffff;
  --badge-error-bg: rgba(167, 37, 63, 0.35);
  --badge-error-text: #ffffff;
  --badge-info-bg: rgba(0, 123, 175, 0.3);
  --badge-info-text: #ffffff;
  --toast-celebration-bg: rgba(211, 178, 87, 0.2);
  --toast-celebration-border: rgba(211, 178, 87, 0.5);
  --toast-celebration-text: #ffffff;
  --urgency-critical-bg: rgba(167, 37, 63, 0.35);
  --urgency-critical-text: #ffffff;
  --urgency-high-bg: rgba(211, 178, 87, 0.2);
  --urgency-high-text: #ffffff;
  --urgency-medium-bg: rgba(0, 123, 175, 0.3);
  --urgency-medium-text: #ffffff;
  --program-spokes-bg: rgba(0, 123, 175, 0.3);
  --program-spokes-text: #ffffff;
  --program-ae-bg: rgba(255, 255, 255, 0.1);
  --program-ae-text: #ffffff;
  --program-ietp-bg: rgba(255, 255, 255, 0);
  --program-ietp-text: #ffffff;
  --program-ietp-border: #d3b257;

  --chat-bubble-assistant-bg: transparent;
  --chat-bubble-assistant-border: transparent;
  --chat-bubble-user-bg: #1e7a2e;
  --chat-bubble-user-avatar: #1e7a2e;
  /* Gold, not primary: primary on a navy panel is 2.3:1, under the 3:1 icon floor. */
  --chat-sage-mark: #d3b257;
  --chat-sage-action: #ffffff;
  --chat-sage-mark-bg: rgba(255, 255, 255, 0.1);
  --chat-panel-bg: #004071;
  --chat-panel-border: rgba(255, 255, 255, 0.12);
  --chat-input-bg: transparent;
  --chat-input-border: rgba(255, 255, 255, 0.6);
  --chat-area-bg: #00133f;
  --chat-header-bg: rgba(0, 19, 63, 0.82);
  --chat-sidebar-bg: #00133f;
  --chat-sidebar-active: rgba(255, 255, 255, 0.12);
  --chat-sidebar-hover: rgba(255, 255, 255, 0.06);
  --chat-typing-dot: var(--ink-muted);
  --chat-error-bg: rgba(211, 178, 87, 0.2);
  --chat-error-border: #d3b257;
  --chat-error-text: #ffffff;
  --chat-composer-focus: rgba(211, 178, 87, 0.4);

  --background: var(--surface-base);
  --foreground: var(--ink-strong);
  --surface: var(--surface-raised);
  --surface-strong: #004071;
  --surface-dark: rgba(0, 19, 63, 0.95);
  --accent-strong: var(--accent-green);
  --accent-secondary: var(--accent-blue);
  --accent-tertiary: var(--accent-gold);

  --paper-bg: #004071;
  --paper-line: rgba(255, 255, 255, 0.04);
  --paper-margin: rgba(167, 37, 63, 0.35);
}
```

- [ ] **Step 4: Extend `@theme inline`.** Keep every existing line in the block and append:

```css
  --color-surface-muted: var(--surface-muted);
  --color-line: var(--border);
  --color-line-control: var(--border-control);

  /* Role utilities. Tailwind 4 reads --text-color-*, --border-color-*,
     --ring-color-*, --outline-color-*, and --divide-color-* before --color-*,
     so one role name paints each property from its own token
     (globals.theme-utilities.test.ts). */
  --color-danger: var(--danger-fill);
  --color-danger-soft: var(--danger-soft);
  --text-color-danger: var(--danger-text);
  --text-color-on-danger: var(--danger-on);
  --border-color-danger: var(--danger-border);
  --ring-color-danger: var(--danger-border);
  --outline-color-danger: var(--danger-border);
  --divide-color-danger: var(--danger-border);
  --color-success: var(--success-fill);
  --color-success-soft: var(--success-soft);
  --text-color-success: var(--success-text);
  --text-color-on-success: var(--success-on);
  --border-color-success: var(--success-border);
  --ring-color-success: var(--success-border);
  --outline-color-success: var(--success-border);
  --divide-color-success: var(--success-border);
  --color-warning: var(--warning-fill);
  --color-warning-soft: var(--warning-soft);
  --text-color-warning: var(--warning-text);
  --text-color-on-warning: var(--warning-on);
  --border-color-warning: var(--warning-border);
  --ring-color-warning: var(--warning-border);
  --outline-color-warning: var(--warning-border);
  --divide-color-warning: var(--warning-border);
  --color-info: var(--info-fill);
  --color-info-soft: var(--info-soft);
  --text-color-info: var(--info-text);
  --text-color-on-info: var(--info-on);
  --border-color-info: var(--info-border);
  --ring-color-info: var(--info-border);
  --outline-color-info: var(--info-border);
  --divide-color-info: var(--info-border);
  --color-brand-deep: var(--brand-deep-fill);
  --color-brand-deep-soft: var(--brand-deep-soft);
  --text-color-brand-deep: var(--brand-deep-text);
  --text-color-on-brand-deep: var(--brand-deep-on);
  --border-color-brand-deep: var(--brand-deep-border);
  --ring-color-brand-deep: var(--brand-deep-border);
  --outline-color-brand-deep: var(--brand-deep-border);
  --divide-color-brand-deep: var(--brand-deep-border);

  /* SPOKES type scale at app size (spec Design 3, approved exception) */
  --text-xs: 0.8125rem;
  --text-sm: 0.9375rem;
  --text-base: 1.0625rem;
  --text-lg: 1.1rem;
  --text-xl: 1.375rem;
  --text-2xl: 1.75rem;
  --text-3xl: 2.125rem;
  --text-4xl: 2.5rem;
  --text-5xl: 3.5rem;

  /* SPOKES corners (spec Design 4) */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 20px;
  --radius-3xl: 24px;
```

- [ ] **Step 5: Replace the body background, ambient lines, display font, focus, and buttons.**

1. In the `body { ... }` rule, add `line-height: 1.6;` after the `font-family` line.
2. Delete the four rules `body::before`, `body::after`, `[data-theme="dark"] body::before`, and `[data-theme="dark"] body::after`, and the `@keyframes ambient-pan` block. Run `grep -n 'ambient' src/app/globals.css`. Expected: no output.
3. Replace the `.font-display { ... }` rule with:

```css
@layer components {
  /* DM Serif Display ships one weight; never let the browser fake a bold. */
  .font-display {
    font-family: var(--font-display), Georgia, serif;
    font-synthesis-weight: none;
    letter-spacing: -0.01em;
  }
}
```

4. Replace the `*:focus-visible { ... }` rule with:

```css
*:focus-visible {
  outline: 2px solid var(--focus-outline);
  outline-offset: 3px;
  box-shadow: 0 0 0 7px var(--focus-ring);
}
```

5. Replace the `.primary-button`, `.primary-button:hover`, and `.primary-button:active` rules with the SPOKES Button primary variant:

```css
.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  position: relative;
  border-radius: var(--radius-md);
  /* SPOKES Button, primary variant: solid primary, white ink. */
  background: var(--primary);
  color: var(--on-primary);
  font-weight: 600;
  cursor: pointer;
  transition:
    transform var(--duration-normal) var(--ease-smooth),
    box-shadow var(--duration-normal) var(--ease-smooth),
    filter var(--duration-normal) var(--ease-smooth);
}

.primary-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px var(--glow-primary);
  filter: brightness(0.92);
}

.primary-button:active {
  transform: translateY(0) scale(0.97);
  box-shadow: none;
}
```

6. In `.secondary-button`, change `border-radius: 999px;` to `border-radius: var(--radius-md);` and `font-weight: 700;` to `font-weight: 600;`.
7. In the `@media (prefers-reduced-motion: reduce)` block, delete `body::before,` and `body::after,` from the selector list, and add before the block's closing brace:

```css
  .primary-button:hover,
  .primary-button:active,
  .surface-section:hover {
    transform: none;
  }
```

- [ ] **Step 6: Map the remaining literals.** Rules outside the token blocks still carry non-palette channels. Write and run this one-shot script:

```bash
cat > "$TMPDIR/spokes-css-literals.mjs" <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
const path = "src/app/globals.css";
const MAP = [
  [/rgba\(0, 0, 0, ([\d.]+)\)/g, "rgba(0, 19, 63, $1)"],
  [/rgba\(15, 23, 42, ([\d.]+)\)/g, "rgba(0, 64, 113, $1)"],
  [/rgba\(7, 23, 43, ([\d.]+)\)/g, "rgba(0, 19, 63, $1)"],
  [/rgba\(0, 93, 138, ([\d.]+)\)/g, "rgba(0, 123, 175, $1)"],
  [/rgba\(42, 138, 60, ([\d.]+)\)/g, "rgba(30, 122, 46, $1)"],
  [/rgba\(255, 241, 222, ([\d.]+)\)/g, "rgba(255, 255, 255, $1)"],
  [/rgba\(238, 245, 255, ([\d.]+)\)/g, "rgba(255, 255, 255, $1)"],
  [/rgba\(254, 240, 138, ([\d.]+)\)/g, "rgba(211, 178, 87, $1)"],
];
const css = MAP.reduce((text, [re, to]) => text.replace(re, to), readFileSync(path, "utf8"));
writeFileSync(path, css);
EOF
node "$TMPDIR/spokes-css-literals.mjs"
```

- [ ] **Step 7: Point the browser chrome at the palette.** In `src/app/layout.tsx`, change the two `themeColor` values: `"#f3f7f8"` to `"#edf3f7"` and `"#0a1628"` to `"#00133f"`.

- [ ] **Step 8: Update the primary-button grader.** The button's fill is now solid primary, so its ink token is `--on-primary`. Two changes, both keep the 4.5:1 check at full strength; the PR description quotes them.

In `src/app/globals.primary-button.test.ts`, replace the body of `primaryButtonRule()` after the `color` line with:

```ts
  const background = rule[1].match(/(?:^|;)\s*background:\s*([^;]+);/)?.[1].trim() ?? "";
  const gradient = background.match(/^linear-gradient\((.*)\)$/)?.[1];
  // A solid fill is one stop; a gradient is every stop after its angle.
  const stops =
    gradient === undefined
      ? background ? [background] : []
      : splitTopLevel(gradient).slice(1).map((stop) => stop.trim().replace(/\s+\d+%$/, ""));
  return { color, stops };
```

and change the first test to:

```ts
  it("takes its ink from --on-primary", () => {
    assert.equal(primaryButtonRule().color, "var(--on-primary)");
  });
```

Add one line to the file's top comment: `2026-10-15: SPOKES makes the primary button solid --primary (spec Design 2.6), so its ink is --on-primary.`

- [ ] **Step 9: Run every token grader.**

```bash
npx tsx --test src/app/globals.*.test.ts src/lib/spokes-palette.test.ts 2>&1 | tail -6
```

Expected: `# fail 0`. If the contrast test reports `--success-text` under 4.5:1 on the page, lower the alpha of `--success-soft` and `--badge-success-bg` (light block) by 0.01 and rerun. Never darken `--success-text`: no darker green is in the palette. If the palette test still lists a literal, map it to the nearest palette color with `npx tsx -e 'import("./src/lib/spokes-palette.ts").then(m => console.log(m.nearestPaletteColor("#xxxxxx")))'` and edit it by hand.

- [ ] **Step 10: Run the full suite.**

```bash
npm test 2>&1 | tail -4
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit; echo "tsc exit $?"
```

Expected: `# fail 0`, `tsc exit 0`. The `globals.tokens.test.ts` grader fails if any component still reads a token this task deleted (`--ambient-lines`); none should.

- [ ] **Step 11: Commit.**

```bash
git add src/app/globals.css src/app/layout.tsx src/app/globals.primary-button.test.ts src/app/globals.motion.test.ts
git commit -m "feat: SPOKES color, type, shape, and motion tokens"
```

## Task 8: Role text, program badges, and the sign-in error icon

**Files:**
- Modify: every file the sweep's `token-text` and `display-family` rules touch (about 84 text uses; exact list from the dry run)
- Modify: `src/components/ui/ProgramBadge.tsx`, `src/components/ui/ProgramBadge.test.tsx`
- Modify: `e2e/spokes-visual.spec.ts` (sign-in error test)
- Modify, only if Step 5 shows no icon: `src/components/auth/AuthPageClient.tsx`

**Interfaces:**
- Consumes: the sweep CLI (Task 6) and the role utilities (Task 7).

- [ ] **Step 1: Dry-run the text sweep across `src`.**

```bash
node scripts/spokes-class-sweep.mjs --paths='src/**/*.tsx,src/**/*.ts' --rules=token-text,display-family > "$TMPDIR/token-text.txt"
tail -1 "$TMPDIR/token-text.txt"; grep -c '^REVIEW' "$TMPDIR/token-text.txt"
```

Expected: about 84 changes; review items listed. For each `REVIEW` line (text with opacity), replace the class by hand with the solid role (`text-danger`, `text-success`, `text-info`, `text-warning`).

- [ ] **Step 2: Apply it.**

```bash
node scripts/spokes-class-sweep.mjs --paths='src/**/*.tsx,src/**/*.ts' --rules=token-text,display-family --write | tail -1
npm test 2>&1 | tail -4
```

Expected: `rewrote N of M file(s)`; `# fail 0`. A unit test that asserted an old class string (such as `text-[var(--error)]`) is an expectation of the old styling: update it to the role class and list it in the PR description.

- [ ] **Step 3: Write the failing program-badge test.** Add to `src/components/ui/ProgramBadge.test.tsx`, inside `describe("ProgramBadge")`:

```tsx
  it("outlines only the IETP badge, so the three differ without color", () => {
    const ietp = renderToString(<ProgramBadge programType="ietp" />);
    const spokes = renderToString(<ProgramBadge programType="spokes" />);
    const ae = renderToString(<ProgramBadge programType="adult_ed" />);
    assert.ok(ietp.includes("border-[var(--program-ietp-border)]"));
    assert.ok(!spokes.includes("border-[var(") && !ae.includes("border-[var("));
  });
```

```bash
npx tsx --test src/components/ui/ProgramBadge.test.tsx
```

Expected: FAIL on the new case.

- [ ] **Step 4: Outline the IETP badge and lift the small size to the floor.** In `src/components/ui/ProgramBadge.tsx`:

```tsx
const PROGRAM_COLOR_CLASSES: Record<ProgramType, string> = {
  spokes: "bg-[var(--program-spokes-bg)] text-[var(--program-spokes-text)]",
  adult_ed: "bg-[var(--program-ae-bg)] text-[var(--program-ae-text)]",
  ietp: "border border-[var(--program-ietp-border)] bg-[var(--program-ietp-bg)] text-[var(--program-ietp-text)]",
};
```

and in `SIZE_CLASSES.sm.container` change `text-[0.65rem]` to `text-xs`.

```bash
npx tsx --test src/components/ui/ProgramBadge.test.tsx src/components/__tests__/touch-targets.test.ts
```

Expected: PASS.

- [ ] **Step 5: Give the sign-in error an icon in both themes.** Add to `e2e/spokes-visual.spec.ts`, after the `"sign-in page"` test:

```ts
test("sign-in error carries an icon", async ({ browser }) => {
  for (const theme of THEMES) {
    const context = await browser.newContext();
    await setTheme(context, theme);
    await withPage(context, async (page) => {
      await page.goto("/");
      await page.getByLabel(/username or email/i).fill("nonexistent-user");
      await page.getByLabel(/password/i).fill("wrongpassword");
      await page.getByRole("button", { name: /sign in to see what to do today/i }).click();
      const alert = page.getByRole("alert").first();
      await expect(alert).toBeVisible();
      // Dark-theme danger text is white (no SPOKES red passes on navy), so the icon carries "error".
      expect(await alert.locator("svg").count(), `${theme}: the error alert has no icon`).toBeGreaterThan(0);
      await page.screenshot({ path: `${OUT}/sign-in-error-${theme}.png` });
    });
  }
});
```

Then check the markup it will meet:

```bash
grep -n 'role="alert"' src/components/auth/AuthPageClient.tsx
```

Read the element on each matching line. If it renders no icon, add one as its first child:

```tsx
<WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />
```

importing `WarningCircle` from `@phosphor-icons/react/dist/ssr` the same way `ProgramBadge.tsx` imports its icons, and make the alert `flex items-start gap-2` if it is not already a flex row. This spec runs only in CI (it needs the app and a database).

- [ ] **Step 6: Commit.**

```bash
git add -A src e2e/spokes-visual.spec.ts
git commit -m "refactor: text colors move onto SPOKES role utilities; IETP badge outlined"
```

## Task 9: SPOKES fonts

**Files:**
- Modify: `src/app/layout.tsx:3,9-17,43`

- [ ] **Step 1: Swap the fonts.** Replace the `next/font/google` import and the two font constants:

```tsx
import { DM_Serif_Display, Outfit } from "next/font/google";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-body",
});

// One weight only: .font-display turns off synthetic bold (globals.css).
const dmSerifDisplay = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});
```

and in `<body className=...>` replace `${manrope.variable} ${sora.variable}` with `${outfit.variable} ${dmSerifDisplay.variable}`.

- [ ] **Step 2: Find any other reference.**

```bash
grep -rniE 'manrope|sora' src e2e scripts --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.css'
```

Expected: no output. Replace any hit with the matching new family.

- [ ] **Step 3: Build.** `next/font` downloads from Google at build time; run this in the Terminal panel if the sandbox blocks `fonts.googleapis.com`.

```bash
npm run build 2>&1 | tail -5
```

Expected: the build completes. Then `grep -cE 'DM_Serif_Display|Outfit' src/app/layout.tsx` prints 2 or more, and `grep -cE 'Sora|Manrope' src/app/layout.tsx` prints 0.

- [ ] **Step 4: Commit.**

```bash
git add src/app/layout.tsx
git commit -m "feat: load SPOKES fonts, DM Serif Display and Outfit"
```

## Task 10: Lint rule `spokes/no-off-palette-color`

**Files:**
- Create: `eslint-rules/spokes-palette.mjs`
- Test: `src/lib/spokes-lint-rule.test.ts`
- Modify: `eslint.config.mjs` (import at the top; three objects appended to the `defineConfig` array after the last `files:` block, the one for `src/components/certifications/CertTracker.tsx`)
- Modify: `src/app/layout.tsx` (two disable comments)

**Interfaces:**
- Consumes: `src/lib/spokes-palette.json` (Task 2).
- Produces: rule id `spokes/no-off-palette-color` with messages `hue`, `hexTsx`, `hexTs`, `smallText`, `softText`; the `SPOKES_UNSWEPT` list that Tasks 14 and 15 shrink and delete.

- [ ] **Step 1: Write the failing rule test.**

```ts
// src/lib/spokes-lint-rule.test.ts
import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/spokes-palette.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: "module" } });
const tsx = "src/components/x.tsx";

tester.run("spokes/no-off-palette-color", rule, {
  valid: [
    { code: 'const a = "bg-danger-soft text-danger border-info";', filename: tsx },
    { code: 'const c = "#004071";', filename: "src/lib/chart.ts" },
    { code: 'const t = "text-[15px] text-[13px]";', filename: tsx },
    { code: 'const href = "#top";', filename: tsx },
    { code: 'const prose = "Use the red pen on page 500";', filename: tsx },
  ],
  invalid: [
    { code: 'const a = "px-2 bg-red-50";', filename: tsx, errors: [{ messageId: "hue" }] },
    { code: "const a = `p-1 ${x} text-amber-700`;", filename: tsx, errors: [{ messageId: "hue" }] },
    { code: 'const a = "hover:border-l-sky-400";', filename: tsx, errors: [{ messageId: "hue" }] },
    { code: 'const c = "#004071";', filename: tsx, errors: [{ messageId: "hexTsx" }] },
    { code: 'const c = "#c43c3c";', filename: "src/lib/chart.ts", errors: [{ messageId: "hexTs" }] },
    { code: 'const a = "text-[0.65rem]";', filename: tsx, errors: [{ messageId: "smallText" }] },
    { code: 'const a = "text-[11px]";', filename: tsx, errors: [{ messageId: "smallText" }] },
    { code: 'const a = "text-danger-soft";', filename: tsx, errors: [{ messageId: "softText" }] },
  ],
});
```

```bash
npx tsx --test src/lib/spokes-lint-rule.test.ts
```

Expected: FAIL, `Cannot find module '../../eslint-rules/spokes-palette.mjs'`.

- [ ] **Step 2: Write the rule.**

```js
// eslint-rules/spokes-palette.mjs
/**
 * spokes/no-off-palette-color: component colors stay on the SPOKES palette and
 * text stays at 13px or larger (docs/superpowers/specs/2026-10-15-spokes-design-system-design.md,
 * Design 6.4). Its own rule rather than no-restricted-syntax selectors: flat
 * config replaces that rule's options per block, so a warn-only block for
 * unswept folders would also weaken the student-log and studentAlert selectors.
 */
import palette from "../src/lib/spokes-palette.json" with { type: "json" };

const HUES = "red|rose|pink|fuchsia|emerald|green|lime|amber|yellow|orange|blue|sky|cyan|teal|indigo|violet|purple|slate|gray|zinc|neutral|stone";
const EDGE = "[\\s\"'`:]";
const HUE_CLASS = new RegExp(`(?:^|${EDGE})((?:bg|text|border(?:-[xytrbl])?|from|via|to|ring|fill|stroke|outline|divide|decoration|accent|caret|placeholder|shadow)-(?:${HUES})-\\d{2,3}(?:\\/\\d{1,3})?)(?=$|[\\s"'\`])`);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-fA-F])/g;
const ARBITRARY_TEXT = new RegExp(`(?:^|${EDGE})(text-\\[(\\d*\\.?\\d+)(px|rem)\\])(?=$|[\\s"'\`])`, "g");
const SOFT_TEXT = new RegExp(`(?:^|${EDGE})(text-(danger|success|warning|info|brand-deep)-soft)(?=$|[\\s"'\`])`);
const PALETTE = new Set(Object.values(palette.colors));

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "Keep component colors on the SPOKES palette and text at 13px or larger" },
    schema: [],
    messages: {
      hue: "{{cls}} is outside the SPOKES palette. Use a role utility (bg-danger, text-success, border-info): spec Design 5.1.",
      hexTsx: "Raw hex {{hex}} in a component. Use a token, var(--...), or a role utility.",
      hexTs: "{{hex}} is not a SPOKES palette color (src/lib/spokes-palette.json).",
      smallText: "{{cls}} renders below the 13px floor. Use text-xs or larger.",
      softText: "{{cls}} paints text in a background tint and fails contrast. Use text-{{role}}.",
    },
  },
  create(context) {
    const isTsx = context.filename.endsWith(".tsx");
    function firstProblem(text) {
      const hue = text.match(HUE_CLASS);
      if (hue) return { messageId: "hue", data: { cls: hue[1] } };
      for (const match of text.matchAll(HEX)) {
        const hex = match[0].toLowerCase();
        if (isTsx) return { messageId: "hexTsx", data: { hex } };
        if (!PALETTE.has(hex.slice(0, 7))) return { messageId: "hexTs", data: { hex } };
      }
      for (const match of text.matchAll(ARBITRARY_TEXT)) {
        const px = Number(match[2]) * (match[3] === "rem" ? 16 : 1);
        if (px < 13) return { messageId: "smallText", data: { cls: match[1] } };
      }
      const soft = text.match(SOFT_TEXT);
      return soft ? { messageId: "softText", data: { cls: soft[1], role: soft[2] } } : null;
    }
    function check(node, text) {
      const problem = firstProblem(text);
      if (problem) context.report({ node, ...problem });
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};
```

```bash
npx tsx --test src/lib/spokes-lint-rule.test.ts
```

Expected: PASS.

- [ ] **Step 3: Wire it into `eslint.config.mjs`.** Add to the imports:

```js
import spokesPalette from "./eslint-rules/spokes-palette.mjs";
```

Add these constants above the `defineConfig` call (fill `SPOKES_UNSWEPT` in Step 4):

```js
// Folders not yet swept onto SPOKES role utilities (spec Design 6.4). The rule
// only warns here. Each sweep PR deletes its entries; the last deletes the list.
const SPOKES_UNSWEPT = [];

// Document renderers outside the SPOKES spec (Design 9: PDFs, email, resume print).
const SPOKES_OUT_OF_SCOPE = [
  "src/lib/certificate-generator.ts",
  "src/lib/email-templates.ts",
  "src/lib/resume.ts",
  "src/lib/resume-layout.ts",
  "src/app/api/forms/orientation-packet/route.ts",
];
```

Append to the `defineConfig` array after the `CertTracker.tsx` block:

```js
  {
    plugins: { spokes: { rules: { "no-off-palette-color": spokesPalette } } },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx", ...SPOKES_OUT_OF_SCOPE],
    rules: { "spokes/no-off-palette-color": "error" },
  },
  {
    files: SPOKES_UNSWEPT,
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx", ...SPOKES_OUT_OF_SCOPE],
    rules: { "spokes/no-off-palette-color": "warn" },
  },
```

- [ ] **Step 4: Fill the unswept list from the real violations.** First mark the two literal `themeColor` values in `src/app/layout.tsx`, which the Next viewport API requires as strings. Put this line directly above each:

```tsx
    // eslint-disable-next-line spokes/no-off-palette-color -- the viewport API takes literal colors; this is a SPOKES palette value
```

Then list every folder that still has a violation:

```bash
npx eslint src -f json -o "$TMPDIR/spokes-lint.json"; node -e '
const r = require(process.argv[1]);
const dirs = new Set(r.filter(f => f.messages.some(m => m.ruleId === "spokes/no-off-palette-color")).map(f => require("path").relative(process.cwd(), f.filePath).replace(/\/[^/]+$/, "")));
console.log([...dirs].sort().map(d => `  "${d}/*",`).join("\n"));' "$TMPDIR/spokes-lint.json"
```

Paste the printed lines into `SPOKES_UNSWEPT`. Expected: about 24 folders, matching the planning measure on `fix/hig-phase-2` (auth, career, certifications, connect, coordinator, dashboard, documents, goals, lms, orientation, portfolio, progression, sage, settings, spokes, student, teacher, ui, vision-board, and a few `src/app` folders). An entry like `src/app/*` covers only the files directly in that folder.

- [ ] **Step 5: Prove the rule fires beside the existing PII rules.**

```bash
cat > src/components/spokes-probe.tsx <<'EOF'
import { logger } from "@/lib/logger";
export function Probe() {
  logger.info("probe", { studentId: "x" });
  return <p className="text-red-600">probe</p>;
}
EOF
npx eslint src/components/spokes-probe.tsx | grep -oE 'spokes/no-off-palette-color|no-restricted-syntax' | sort -u
rm src/components/spokes-probe.tsx
npm run lint 2>&1 | tail -3
```

Expected: both rule ids print; after the probe is removed, `npm run lint` exits 0 with warnings only, from unswept folders.

- [ ] **Step 6: Commit.**

```bash
git add eslint-rules/spokes-palette.mjs src/lib/spokes-lint-rule.test.ts eslint.config.mjs src/app/layout.tsx
git commit -m "feat: lint component colors against the SPOKES palette"
```

## Task 11: Design docs name SPOKES as the source of truth

**Files:**
- Modify: `.impeccable.md`, `CLAUDE.md` (Design Context), `.claude/agents/ux-reviewer.md` (`## Design System`), `.claude/MEMORY.md` (Key Decisions Log, Architecture Notes)

- [ ] **Step 1: `.impeccable.md`.** Replace the `- **Current stack**:` line with:

```markdown
- **Current stack**: Tailwind CSS 4, Framer Motion, Phosphor Icons, DM Serif Display (display) + Outfit (body) fonts, tokens from the SPOKES Design System
```

Replace the whole `### Color System Summary` section with:

```markdown
### Color System Summary
- **Source of truth**: the SPOKES Design System, https://claude.ai/artifact/5cF3cJB5x5K4qj4wb9G2dh. VisionQuest follows it strictly; `src/app/globals.palette.test.ts` fails on any other color.
- **Palette**: primary `#007baf`, accent `#37b550`, dark `#004071`, light `#ffffff`, muted `#edf3f7`, gray `#60636b`, gold `#d3b257`, royal `#00133f`, mauve `#a7253f`, offwhite `#d1d3d4`, muted-gold `#ad8806`, accent-text `#1e7a2e`. Any transparency of these is allowed.
- **Roles**: components use the `danger`, `success`, `warning`, `info`, and `brand-deep` utilities (`bg-danger`, `bg-danger-soft`, `text-danger`, `border-danger`), never Tailwind hues. The lint rule `spokes/no-off-palette-color` enforces it.
- **Surfaces**: light theme is a muted page with solid white cards; dark theme is a royal page with dark-navy cards. Blur only on sticky bars.
- **Dark theme text**: no SPOKES red, green, or blue passes as text on navy, so role text is white and the hue rides on fills, dots, and borders. Errors always carry an icon.
- **Exceptions to SPOKES** (approved 2026-10-15): a focus ring that passes contrast (navy outline with a gold halo in light, gold outline in dark), Phosphor icons, and the SPOKES mobile type scale instead of the slide scale.
```

Replace the whole `### Typography Summary` section with:

```markdown
### Typography Summary
- **Display**: DM Serif Display, weight 400 only. Never put a bold class on display text; the browser would fake it.
- **Body**: Outfit.
- **Scale**: the SPOKES mobile scale through Tailwind's names: `text-xs` 13px, `text-sm` 15px, `text-base` 17px, `text-xl` 22px, `text-3xl` 34px. Nothing renders below 13px.
- **Low literacy consideration**: larger body text, line height 1.6, short line lengths.
```

- [ ] **Step 2: `CLAUDE.md`.** Under `## Design Context`, add after the `- **Full design context**:` line:

```markdown
- **Brand source of truth**: the SPOKES Design System (https://claude.ai/artifact/5cF3cJB5x5K4qj4wb9G2dh). VisionQuest follows it strictly with three approved exceptions, listed in `.impeccable.md`
```

- [ ] **Step 3: `.claude/agents/ux-reviewer.md`.** In the `## Design System` section, delete any line that names Sora, Manrope, or a hex value outside the palette, and append:

```markdown
Check every surface against the SPOKES Design System (https://claude.ai/artifact/5cF3cJB5x5K4qj4wb9G2dh) as applied in `.impeccable.md`: palette colors only, role utilities instead of Tailwind hues, DM Serif Display headings with no bold class, Outfit body text, nothing under 13px, and the focus ring (navy outline with a gold halo in light, gold outline in dark). In the dark theme, an error must carry an icon, because its text is white.
```

- [ ] **Step 4: `.claude/MEMORY.md`.** Add these rows at the top of the Key Decisions Log table:

```markdown
| 2026-10-15 | VisionQuest follows the SPOKES Design System strictly (artifact 5cF3cJB5x5K4qj4wb9G2dh): 12 palette colors, DM Serif Display + Outfit, role utilities, guarded by `globals.palette.test.ts` and `spokes/no-off-palette-color` | Britt chose an official brand match over an inspired refresh; spec `docs/superpowers/specs/2026-10-15-spokes-design-system-design.md` |
| 2026-10-15 | Three approved exceptions to SPOKES (passing focus ring, Phosphor icons, app-size type) and three corrected SPOKES values (green button fill is accent-text, shadow-hover uses royal, page background is solid muted) | Each replaced SPOKES value fails WCAG AA or the palette rule; recorded so the artifact can be fixed upstream |
| 2026-10-15 | Dark-theme role text is white; the hue rides on fills, dots, and borders | No SPOKES red, green, or blue clears 4.5:1 as text on navy (mauve is about 1.5:1) |
```

and to Architecture Notes:

```markdown
- Design tokens: SPOKES values in `src/app/globals.css`. Role utilities come from Tailwind 4 per-property namespaces (`--text-color-*`, `--border-color-*` read before `--color-*`), pinned by `src/app/globals.theme-utilities.test.ts`. Class sweeps: `node scripts/spokes-class-sweep.mjs`
```

- [ ] **Step 5: Check the prose and commit.**

```bash
grep -c "$(printf '\342\200\224')" .impeccable.md CLAUDE.md .claude/agents/ux-reviewer.md | grep -v ':0$'
grep -c '5cF3cJB5x5K4qj4wb9G2dh' .impeccable.md CLAUDE.md .claude/agents/ux-reviewer.md
git add .impeccable.md CLAUDE.md .claude/agents/ux-reviewer.md .claude/MEMORY.md
git commit -m "docs: SPOKES Design System is the design source of truth"
```

Expected: the first grep prints nothing for the lines you added (pre-existing em dashes elsewhere in those files are out of scope); the second prints 1 or more per file.

## Task 12: Verify PR 1 and hand it to Britt

**Files:**
- Modify: `.github/workflows/ci.yml` (remove `continue-on-error: true` from the screenshot step, Step 5)

- [ ] **Step 1: Local gates.**

```bash
npm test 2>&1 | tail -4
npm run lint 2>&1 | tail -3
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit; echo "tsc exit $?"
npx tsx scripts/ui-copy-readability.mjs --gate 2>&1 | tail -2
```

Expected: `# fail 0`, lint exit 0 (warnings allowed), `tsc exit 0`, readability gate passes.

- [ ] **Step 2: Push.** With Britt's OK, in the Terminal panel: `git push`. Wait for CI (do not poll; the app reports CI events). Expected: `verify` and `e2e` jobs pass, including both axe steps.

- [ ] **Step 3: Build the review page.** In the Terminal panel, with the run ids from Task 1 (before) and Step 2 (after):

```bash
gh run download <before-run-id> --repo doclegg05/VisionQuest -n spokes-visual -D "$TMPDIR/spokes-before"
gh run download <after-run-id> --repo doclegg05/VisionQuest -n spokes-visual -D "$TMPDIR/spokes-after"
node scripts/spokes-gallery.mjs "$TMPDIR/spokes-before" "$TMPDIR/spokes-after" "<scratchpad>/spokes-review-pr1"
```

Load the `artifact-design` skill, then publish `<scratchpad>/spokes-review-pr1/index.html` with the Artifact tool, passing every PNG under `before/` and `after/` in `files` by its relative path. Send Britt the link.

- [ ] **Step 4: Write the PR description.** Include:
  - the red output from Task 3 Step 3 and Task 4 Step 3, then the green runs from Task 7 Step 9
  - the two `globals.primary-button.test.ts` changes (ink token, solid fill) and why
  - every unit-test expectation updated in Task 8 Step 2
  - that `globals.css` was already over the 800-line rule and the split is left for a follow-up
  - a test plan with checkboxes: `- [ ] Britt reviews the screenshot page in both themes`, `- [ ] Britt picks the release time relative to class sessions`, `- [ ] Teachers get a heads-up before deploy`

- [ ] **Step 5: Make the screenshot step a gate.** Once a CI run shows no `scrolls sideways` and no `has no icon` failures, delete the `continue-on-error: true` line and its comment's "Not a gate yet" sentence from the screenshot step, commit `ci: SPOKES screenshot checks gate the e2e job`, and push with Britt's OK. If a page does scroll sideways, fix that page's layout first (the failure names the page, theme, and width).

PR 1 is done when Britt approves the screenshots and merges.

---

# PR 2: Student sweep

Start after PR 1 merges:

```bash
cd /Users/brittlegg/MacDev/companies/education/VisionQuest/.claude/worktrees/spokes-design
git fetch origin && git switch -c design/spokes-student-sweep origin/main
```

## Task 13: Prove the sweep script against hand edits

**Files:**
- Modify (by hand, then by script): `src/components/goals/GoalRowActions.tsx`, `src/components/documents/DocumentCard.tsx`, `src/components/career/LearningPathway.tsx`

- [ ] **Step 1: Edit the three files by hand** using the mapping in spec Design 5.1 (and Task 5's cases): each off-palette hue class becomes its role utility, `dark:` hue classes are deleted, arbitrary radii move to the nearest step, and sizes under 13px become `text-xs`.

- [ ] **Step 2: Set the hand versions aside and let the script redo them.** Do not use `git stash` (the stash is shared across worktrees).

```bash
F="src/components/goals/GoalRowActions.tsx src/components/documents/DocumentCard.tsx src/components/career/LearningPathway.tsx"
mkdir -p "$TMPDIR/hand" && for f in $F; do cp "$f" "$TMPDIR/hand/$(basename "$f")"; done
git checkout -- $F
node scripts/spokes-class-sweep.mjs --paths="$(echo $F | tr ' ' ',')" --write
for f in $F; do diff "$TMPDIR/hand/$(basename "$f")" "$f"; done; echo "diff done"
```

Expected: only `diff done` prints. For each difference, decide which side is right. If the script is wrong, add the case to `src/lib/spokes-class-map.test.ts`, watch it fail, fix `scripts/lib/spokes-class-map.mjs`, and rerun this step. Quote the final empty diff in the PR description.

- [ ] **Step 3: Commit.**

```bash
git add scripts/lib src/lib/spokes-class-map.test.ts src/components/goals/GoalRowActions.tsx src/components/documents/DocumentCard.tsx src/components/career/LearningPathway.tsx
git commit -m "refactor: first three student components on SPOKES roles, matching the hand edits"
```

## Task 14: Sweep the student components

**Files:**
- Modify: files under `src/components/{goals,portfolio,orientation,career,sage,lms,vision-board,spokes,documents,certifications,student,settings,dashboard,ui}` and `src/app/(student)`
- Modify: `eslint.config.mjs` (remove those entries from `SPOKES_UNSWEPT`)

- [ ] **Step 1: Dry run and read every review item.**

```bash
G='src/components/goals/**/*.ts*,src/components/portfolio/**/*.ts*,src/components/orientation/**/*.ts*,src/components/career/**/*.ts*,src/components/sage/**/*.ts*,src/components/lms/**/*.ts*,src/components/vision-board/**/*.ts*,src/components/spokes/**/*.ts*,src/components/documents/**/*.ts*,src/components/certifications/**/*.ts*,src/components/student/**/*.ts*,src/components/settings/**/*.ts*,src/components/dashboard/**/*.ts*,src/components/ui/**/*.ts*,src/app/(student)/**/*.ts*'
node scripts/spokes-class-sweep.mjs --paths="$G" > "$TMPDIR/student-sweep.txt"; tail -1 "$TMPDIR/student-sweep.txt"
grep '^REVIEW' "$TMPDIR/student-sweep.txt"
```

Fix each `REVIEW` item by hand:
- **Template-built names** (`` `bg-${tone}-100` ``): replace with a lookup object of complete class names, for example `const TONE_BG = { danger: "bg-danger-soft", success: "bg-success-soft" } as const;`. Tailwind cannot see a computed name, so this also fixes a latent bug.
- **Placeholder hues:** `placeholder:text-ink-faint`.
- **Text with opacity:** the solid role.
- **Odd neutrals:** `text-ink-strong`, `text-ink-muted`, or `bg-surface-muted`, whichever matches the element's job.

- [ ] **Step 2: Apply and fix the raw hex in these folders.**

```bash
node scripts/spokes-class-sweep.mjs --paths="$G" --write | tail -1
npx eslint src/components src/app 2>&1 | grep -E 'hexTsx|Raw hex' | head -20
```

For each raw-hex hit (expected in `VisionBoardPin.tsx`, `CorkboardCanvas.tsx`, `GoalsPageClient.tsx`, `MountainProgressLazy.tsx`, `NavBar.tsx`, `ReadinessScore.tsx`, `SignaturePad.tsx`, `SettingsView.tsx`, `DashboardClient.tsx`):
- **In a class or style:** use the token, for example `var(--ink-strong)`.
- **In canvas drawing code, which needs a literal:** `import { SPOKES_COLORS } from "@/lib/spokes-palette";` and use `SPOKES_COLORS.get("<name>")`, picking the name with `nearestPaletteColor("<hex>")`.
- **In a chart series:** use `SPOKES_CHART_SERIES[i]`.
- **For vision-board pin colors:** build the choice list from `SPOKES_COLORS`.

Check any color that sits behind text with `contrastRatio` in that component's test.

- [ ] **Step 3: Remove the swept folders from the unswept list.** Delete every `SPOKES_UNSWEPT` entry whose folder is in `$G`.

```bash
npm run lint 2>&1 | grep -c 'spokes/no-off-palette-color.*error'
```

Expected: `0`.

- [ ] **Step 4: Gates, push, review.** Run Task 12 Steps 1 to 3 for this branch (PR title `refactor: student components on SPOKES roles`, draft, base `main`). For the gallery, the "before" set is PR 1's after run. In the description, list every hand fix from Step 1 and every expectation update.

- [ ] **Step 5: Commit** (before the push in Step 4).

```bash
git add -A src eslint.config.mjs
git commit -m "refactor: student components on SPOKES role utilities"
```

PR 2 is done when Britt approves the screenshots and merges.

---

# PR 3: Remaining sweep

Start after PR 2 merges: `git fetch origin && git switch -c design/spokes-remaining-sweep origin/main`.

## Task 15: Sweep the rest and retire the unswept list

**Files:**
- Modify: files in every folder still in `SPOKES_UNSWEPT` (auth, connect, coordinator, progression, teacher, the `src/app` root folders, `src/lib` maps), `src/components/goals/confetti.ts`
- Modify: `eslint.config.mjs` (delete `SPOKES_UNSWEPT` and its block)

- [ ] **Step 1: Sweep what is left.**

```bash
node -e 'const s=require("fs").readFileSync("eslint.config.mjs","utf8"); const list=s.match(/SPOKES_UNSWEPT = \[([\s\S]*?)\]/)[1].match(/"([^"]+)"/g).map(x=>x.slice(1,-1).replace(/\*$/,"**/*.ts*")); console.log(list.join(","))' > "$TMPDIR/rest-globs.txt"
node scripts/spokes-class-sweep.mjs --paths="$(cat "$TMPDIR/rest-globs.txt"),src/lib/**/*.ts" > "$TMPDIR/rest-sweep.txt"; tail -1 "$TMPDIR/rest-sweep.txt"; grep '^REVIEW' "$TMPDIR/rest-sweep.txt"
```

Fix review items as in Task 14 Step 1, then rerun with `--write`.

- [ ] **Step 2: Fix the remaining raw hex by hand.** Expected in `CoordinatorRegionMap.tsx`, `MoodSparkline.tsx`, `AiSafetyReportPanel.tsx`, `GrantKpiReport.tsx`, `AuthPageClient.tsx`, and `confetti.ts`. Charts and the region map use `SPOKES_CHART_SERIES`. For a choropleth that needs a ramp, use one palette color at stepped alpha (`rgba(0, 64, 113, 0.2)` up to `1`). Confetti uses palette hex values.

- [ ] **Step 3: Delete the unswept list.** Remove the `SPOKES_UNSWEPT` constant, its comment, and the config object that uses it.

```bash
grep -c SPOKES_UNSWEPT eslint.config.mjs
npm run lint 2>&1 | tail -3
```

Expected: `0`; lint exit 0 with no `spokes/no-off-palette-color` warnings.

- [ ] **Step 4: Spec Definition-of-done greps.**

```bash
git grep -nE '(bg|text|border|from|to|via|ring|fill|stroke|outline|divide|decoration|accent|caret)-(red|amber|yellow|orange|purple|violet|indigo|pink|rose|emerald|teal|cyan|sky|lime|fuchsia|green|blue|slate|gray|zinc|neutral|stone)-[0-9]{2,3}' -- 'src/**/*.tsx' 'src/**/*.ts' | grep -vE '\.test\.tsx?:'
git grep -nE '#[0-9a-fA-F]{6}([^0-9a-fA-F]|$)' -- 'src/**/*.tsx' | grep -vE '\.test\.tsx?:|eslint-disable'
git grep -nE 'font-display[^"]*font-(semibold|bold|extrabold)|font-(semibold|bold|extrabold)[^"]*font-display' -- 'src/**/*.tsx'
```

Expected: no output from any of the three (the layout `themeColor` lines carry disable comments and are filtered).

- [ ] **Step 5: Commit, then gates, push, review** as in Task 14 Step 4 (title `refactor: remaining components on SPOKES roles; palette lint is an error everywhere`).

```bash
git add -A src eslint.config.mjs
git commit -m "refactor: remaining components on SPOKES roles; palette lint is an error everywhere"
```

---

# PR 4: Polish

Start after PR 3 merges: `git fetch origin && git switch -c design/spokes-polish origin/main`.

## Task 16: Cards and callouts

**Files:**
- Modify: `src/app/globals.css` (`.surface-section`, `.surface-section:hover`, `.theme-card`, `.panel`, `.panel-strong`; new `.callout`)
- Create: `src/app/globals.cards.test.ts`
- Modify: the components that render tips, Sage suggestions, or activity prompts (found in Step 4)

- [ ] **Step 1: Write the failing test.**

```ts
// src/app/globals.cards.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One card treatment app-wide, and a SPOKES left-border callout (spec Design 7). */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ruleBody = (selector: string) => {
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.:]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule not found`);
  return match[1];
};

describe("SPOKES cards", () => {
  for (const selector of [".surface-section", ".theme-card", ".panel"]) {
    it(`${selector} is a solid card with a hairline, 12px corners, and the card shadow`, () => {
      const body = ruleBody(selector);
      assert.match(body, /background: var\(--surface-raised\)/);
      assert.match(body, /border: 1px solid var\(--border\)/);
      assert.match(body, /border-radius: var\(--radius-lg\)/);
      assert.match(body, /box-shadow: var\(--shadow-card\)/);
      assert.doesNotMatch(body, /backdrop-filter/);
    });
  }

  it("lifts only cards that are links or buttons", () => {
    const lift = ruleBody(".surface-section:is(a, button):hover");
    assert.match(lift, /transform: translateY\(-5px\)/);
  });

  it("draws callouts with the SPOKES 6px left border", () => {
    assert.match(ruleBody(".callout"), /border-left: 6px solid var\(--success-border\)/);
    assert.match(ruleBody(".callout-gold"), /border-left-color: var\(--gold\)/);
  });
});
```

```bash
npx tsx --test src/app/globals.cards.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Restyle the cards.** For each of `.surface-section`, `.theme-card`, and `.panel`, keep its other declarations (padding, position, transitions) and set:

```css
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
```

Remove `backdrop-filter` and the sheen gradient background from each. Remove the `[data-theme="dark"] .theme-card` override if it only restated background or border. In `.panel-strong`, replace any background with `var(--surface-raised)`.

Replace the `@media (hover: hover) { .surface-section:hover { ... } }` block with:

```css
@media (hover: hover) {
  /* Only cards that are links or buttons lift; a static section that moves under
     the pointer suggests it can be clicked. */
  .surface-section:is(a, button):hover,
  .theme-card:is(a, button):hover {
    transform: translateY(-5px);
    box-shadow: var(--shadow-premium-hover);
  }
}
```

Add to the reduced-motion block's `transform: none` selector list: `.surface-section:is(a, button):hover` and `.theme-card:is(a, button):hover`. Then update the selector in `src/app/globals.motion.test.ts` from `.surface-section:hover` to `.surface-section:is(a, button):hover`; it is the same guarantee for the renamed rule.

- [ ] **Step 3: Add the callout.**

```css
@layer components {
  /* SPOKES left-border card, for tips, Sage suggestions, and activity prompts only. */
  .callout {
    border-left: 6px solid var(--success-border);
    background: var(--surface-muted);
    border-radius: var(--radius-lg);
    padding: 1rem 1.25rem;
  }

  .callout-gold {
    border-left-color: var(--gold);
  }
}
```

```bash
npx tsx --test src/app/globals.cards.test.ts src/app/globals.motion.test.ts
```

Expected: PASS.

- [ ] **Step 4: Apply callouts.**

```bash
git grep -nE 'Sage suggests|Tip:|Pro tip|Try this|Activity' -- 'src/components/**/*.tsx' | grep -v test
```

On each container that frames such content, replace its card classes with `callout`, or `callout callout-gold` for achievement content. Leave every other card alone.

- [ ] **Step 5: Commit.**

```bash
git add src/app/globals.css src/app/globals.cards.test.ts src/app/globals.motion.test.ts src/components
git commit -m "feat: one SPOKES card treatment and a left-border callout"
```

## Task 17: Page header

**Files:**
- Modify: `src/app/globals.css` (`.page-hero`, `.page-hero::before`, `.page-hero::after`, `.page-eyebrow`, `.page-title`, `.page-subtitle`; reduced-motion list)
- Create: `src/app/globals.page-header.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/app/globals.page-header.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** SPOKES title treatment: navy-to-primary ground, white text, a short gold rule (spec Design 7). */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ruleBody = (selector: string) => {
  const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.:]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule not found`);
  return match[1];
};

describe("SPOKES page header", () => {
  it("paints the SPOKES title gradient from palette tokens only", () => {
    assert.match(ruleBody(".page-hero"), /background: linear-gradient\(135deg, var\(--primary\) 0%, var\(--dark\) 100%\)/);
  });

  it("keeps eyebrow, title, and subtitle fully white, which clears 4.5:1 on primary", () => {
    for (const selector of [".page-eyebrow", ".page-subtitle"]) assert.match(ruleBody(selector), /color: var\(--light\)/);
  });

  it("underlines the title with a 48px by 3px gold rule", () => {
    const rule = ruleBody(".page-title::after");
    assert.match(rule, /width: 48px/);
    assert.match(rule, /height: 3px/);
    assert.match(rule, /background: var\(--gold\)/);
  });

  it("drops the diagonal stripes and the angled gold line", () => {
    assert.doesNotMatch(css, /\.page-hero::before/);
    assert.doesNotMatch(css, /\.page-hero::after/);
  });
});
```

```bash
npx tsx --test src/app/globals.page-header.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Restyle the header.** In `.page-hero`, replace the `border`, `background`, `color`, `border-radius`, and `box-shadow` declarations with:

```css
  border: none;
  border-radius: var(--radius-xl);
  /* SPOKES --grad-title */
  background: linear-gradient(135deg, var(--primary) 0%, var(--dark) 100%);
  color: var(--light);
  box-shadow: var(--shadow-card-lg);
```

Delete the `.page-hero::before` and `.page-hero::after` rules, and remove `.page-hero::after` from the reduced-motion selector list. Then set:

```css
.page-eyebrow {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--light);
}

.page-title {
  margin-top: 0.55rem;
  font-family: var(--font-display), Georgia, serif;
  font-size: 2.125rem;
  font-synthesis-weight: none;
  line-height: 1.1;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

.page-title::after {
  content: "";
  display: block;
  width: 48px;
  height: 3px;
  margin-top: 0.75rem;
  background: var(--gold);
}

.page-subtitle {
  margin-top: 0.75rem;
  max-width: 44rem;
  color: var(--light);
  font-size: 1.0625rem;
  line-height: 1.6;
  text-wrap: pretty;
}

@media (min-width: 640px) {
  .page-title {
    font-size: 2.5rem;
  }
}
```

```bash
npx tsx --test src/app/globals.page-header.test.ts src/app/globals.*.test.ts 2>&1 | tail -3
```

Expected: `# fail 0`.

- [ ] **Step 3: Commit.**

```bash
git add src/app/globals.css src/app/globals.page-header.test.ts
git commit -m "feat: SPOKES page header with serif title and gold rule"
```

## Task 18: Progress bars

**Files:**
- Modify: `src/app/globals.css` (new `.progress-fill`)
- Modify: each progress fill element found in Step 3
- Create: `src/app/globals.progress.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// src/app/globals.progress.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SPOKES --grad-progress runs primary to gold. Gold on a light track is about
 * 1.8:1, under the 3:1 floor for graphics, so the fill carries an inset edge in
 * --progress-edge (navy in light, gold in dark). globals.contrast.test.ts checks
 * that edge against the page, cards, and muted panels.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("SPOKES progress fill", () => {
  it("uses the SPOKES gradient with a contrast edge", () => {
    const match = css.match(/\.progress-fill\s*\{([^}]*)\}/);
    assert.ok(match, ".progress-fill rule not found");
    assert.match(match[1], /background: var\(--grad-progress\)/);
    assert.match(match[1], /box-shadow: inset 0 0 0 1px var\(--progress-edge\)/);
  });
});
```

```bash
npx tsx --test src/app/globals.progress.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Add the rule** inside the existing `@layer components` block:

```css
  .progress-fill {
    background: var(--grad-progress);
    box-shadow: inset 0 0 0 1px var(--progress-edge);
  }
```

- [ ] **Step 3: Apply it.**

```bash
git grep -lE 'role="progressbar"' -- 'src/components/**/*.tsx' | grep -v test
```

In each file, find the element whose width or `scaleX` shows the value, the fill inside the track. Replace its background classes (`bg-[var(--accent-green)]`, `bg-success`, `bg-gradient-*`) with `progress-fill`. Keep the mountain graphic in `MountainProgressLazy.tsx` as drawn; it is an illustration, not a bar.

```bash
npx tsx --test src/app/globals.progress.test.ts src/components/orientation/WizardStepIndicator.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/app/globals.css src/app/globals.progress.test.ts src/components
git commit -m "feat: SPOKES progress gradient with a contrast edge"
```

## Task 19: Logo plate on navy grounds

**Files:**
- Create: `src/components/ui/LogoPlate.tsx`
- Test: `src/components/ui/LogoPlate.test.tsx`
- Modify: every component that renders `/spokes-logo.png` (found in Step 3)

**Interfaces:**
- Produces: `LogoPlate({ onDark?: boolean, children: React.ReactNode })`. With `onDark`, the plate always shows; without it, it shows only in the dark theme.

- [ ] **Step 1: Write the failing test.**

```tsx
// src/components/ui/LogoPlate.test.tsx
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { LogoPlate } from "./LogoPlate";

describe("LogoPlate", () => {
  it("always shows the white plate on a navy ground", () => {
    const html = renderToString(<LogoPlate onDark><img alt="SPOKES" src="/spokes-logo.png" /></LogoPlate>);
    assert.match(html, /class="[^"]*\bbg-white\b/);
    assert.doesNotMatch(html, /dark:bg-white/);
  });

  it("shows the plate only in the dark theme on a light ground", () => {
    const html = renderToString(<LogoPlate><img alt="SPOKES" src="/spokes-logo.png" /></LogoPlate>);
    assert.match(html, /dark:bg-white/);
  });
});
```

```bash
npx tsx --test src/components/ui/LogoPlate.test.tsx
```

Expected: FAIL, module not found.

- [ ] **Step 2: Write the component.**

```tsx
// src/components/ui/LogoPlate.tsx
import type { ReactNode } from "react";

interface LogoPlateProps {
  /** The logo sits on a navy or royal ground in every theme, such as the sign-in hero. */
  onDark?: boolean;
  children: ReactNode;
}

/** SPOKES rule: the full-color logo goes on a white rounded plate over navy or royal. */
export function LogoPlate({ onDark = false, children }: LogoPlateProps) {
  const plate = onDark ? "bg-white" : "dark:bg-white";
  return <span className={`inline-flex items-center justify-center rounded-xl p-1.5 ${plate}`}>{children}</span>;
}
```

```bash
npx tsx --test src/components/ui/LogoPlate.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Wrap each logo.**

```bash
git grep -lE 'spokes-logo\.png' -- 'src/**/*.tsx' | grep -v test
```

In each file, wrap the logo `<Image>` or `<img>` in `<LogoPlate>`. Pass `onDark` where the logo sits inside an always-dark surface: the sign-in hero panel (`.auth-hero-panel`) and the `.page-hero`.

- [ ] **Step 4: Commit.**

```bash
git add src/components/ui/LogoPlate.tsx src/components/ui/LogoPlate.test.tsx src
git commit -m "feat: SPOKES logo plate on navy grounds"
```

## Task 20: Title Case headings

**Files:**
- Create: `scripts/lib/title-case.mjs`, `scripts/spokes-heading-case.mjs`
- Test: `src/lib/title-case.test.ts`
- Modify: components with `h1`, `h2`, or `h3` literal text, and any `.page-title` element

**Interfaces:**
- Produces: `titleCase(text: string): string`; CLI `node scripts/spokes-heading-case.mjs --paths=<glob>[,...] [--write]`.

- [ ] **Step 1: Write the failing test.**

```ts
// src/lib/title-case.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { titleCase } from "../../scripts/lib/title-case.mjs";

describe("titleCase (SPOKES content rules: titles and card headings)", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["your next step", "Your Next Step"],
    ["finish your résumé", "Finish Your Résumé"],
    ["goals and pathways", "Goals and Pathways"],
    ["what to do today", "What to Do Today"],
    ["talk to Sage", "Talk to Sage"],
    ["SPOKES orientation", "SPOKES Orientation"],
    ["check in", "Check In"],
    ["follow-up tasks", "Follow-Up Tasks"],
    ["you're on track", "You're on Track"],
    ["IC3 practice", "IC3 Practice"],
    ["step 2 of 8", "Step 2 of 8"],
    ["  spaced  out  ", "  Spaced  Out  "],
  ];
  for (const [input, expected] of cases) it(`"${input}"`, () => assert.equal(titleCase(input), expected));
});
```

```bash
npx tsx --test src/lib/title-case.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 2: Write `titleCase`.**

```js
// scripts/lib/title-case.mjs
/**
 * Title Case for page titles and card headings (SPOKES content fundamentals).
 * Small words stay lowercase unless first or last; a word that already holds a
 * capital (SPOKES, IC3, Sage) is left as written.
 */
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "per", "the", "to", "up", "via", "vs", "with"]);

const capitalize = (part) => (/[A-Z]/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1));

function caseWord(word, isEdge) {
  if (!isEdge && SMALL.has(word.toLowerCase())) return word.toLowerCase();
  return word.split("-").map(capitalize).join("-");
}

export function titleCase(text) {
  const parts = text.split(/(\s+)/);
  const wordIndexes = parts.map((part, i) => (part.trim() ? i : -1)).filter((i) => i >= 0);
  const first = wordIndexes[0];
  const last = wordIndexes.at(-1);
  return parts.map((part, i) => (part.trim() ? caseWord(part, i === first || i === last) : part)).join("");
}
```

```bash
npx tsx --test src/lib/title-case.test.ts
```

Expected: PASS.

- [ ] **Step 3: Write the heading CLI.**

```js
// scripts/spokes-heading-case.mjs
// node scripts/spokes-heading-case.mjs --paths=<glob>[,...] [--write]
// Title-cases literal text directly inside h1, h2, h3, and .page-title elements.
import { globSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { titleCase } from "./lib/title-case.mjs";

const args = process.argv.slice(2);
const paths = args.find((a) => a.startsWith("--paths="))?.slice(8);
if (!paths) {
  console.error("usage: node scripts/spokes-heading-case.mjs --paths=<glob>[,...] [--write]");
  process.exit(2);
}
const write = args.includes("--write");
const HEADINGS = new Set(["h1", "h2", "h3"]);

function isHeading(element) {
  const opening = element.openingElement;
  if (HEADINGS.has(opening.tagName.getText())) return true;
  return opening.attributes.properties.some(
    (attr) => ts.isJsxAttribute(attr) && attr.name.getText() === "className" && attr.initializer && /\bpage-title\b/.test(attr.initializer.getText()),
  );
}

function headingEdits(file) {
  const edits = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && isHeading(node)) {
      for (const child of node.children) {
        const literal = ts.isJsxExpression(child) && child.expression && ts.isStringLiteral(child.expression) ? child.expression : null;
        const target = ts.isJsxText(child) && child.getText().trim() ? child : literal;
        if (!target) continue;
        const start = target.getStart(file) + (literal ? 1 : 0);
        const end = target.getEnd() - (literal ? 1 : 0);
        const before = file.text.slice(start, end);
        const after = titleCase(before);
        if (after !== before) edits.push({ start, end, before, after, line: file.getLineAndCharacterOfPosition(start).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return edits;
}

const files = [...new Set(paths.split(",").flatMap((glob) => globSync(glob)))].filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f)).sort();
let changed = 0;
for (const name of files) {
  const source = readFileSync(name, "utf8");
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = headingEdits(file);
  for (const e of edits) console.log(`${name}:${e.line}  "${e.before.trim()}" -> "${e.after.trim()}"`);
  if (edits.length === 0) continue;
  changed += 1;
  const output = [...edits].sort((a, b) => b.start - a.start).reduce((text, e) => text.slice(0, e.start) + e.after + text.slice(e.end), source);
  if (write) writeFileSync(name, output);
}
console.log(`${write ? "rewrote" : "would rewrite"} ${changed} file(s)`);
```

- [ ] **Step 4: Dry run, read, apply.**

```bash
node scripts/spokes-heading-case.mjs --paths='src/components/**/*.tsx,src/app/**/*.tsx' > "$TMPDIR/headings.txt"; tail -1 "$TMPDIR/headings.txt"
```

Read every line. Revert by hand any heading that is a sentence rather than a title (a question such as "Where does your time go?" stays in sentence case, per SPOKES voice). Then rerun with `--write`.

- [ ] **Step 5: Update tests that pin heading text.**

```bash
npm test 2>&1 | grep -E '^not ok' | head -20
git grep -nE 'getByRole\("heading", \{ name: "[^"]+", exact: true' -- e2e
npx tsx scripts/ui-copy-readability.mjs --gate 2>&1 | tail -2
```

For each failing assertion, update the expected heading to its Title Case form and list it in the PR description. Expected after updates: `# fail 0`; the readability gate passes (case does not change reading level).

- [ ] **Step 6: Commit.**

```bash
git add scripts/lib/title-case.mjs scripts/spokes-heading-case.mjs src/lib/title-case.test.ts src e2e
git commit -m "feat: Title Case page titles and card headings per SPOKES content rules"
```

## Task 21: Verify PR 4, review, and close out

**Files:**
- Modify: `.claude/MEMORY.md` (Current Status, Last Session)

- [ ] **Step 1: UX review.** Dispatch the `ux-reviewer` agent on `git diff origin/main...HEAD`, pointing it at the spec and `.impeccable.md`. Fix every CRITICAL finding and rerun until none remain. Quote the final report's CRITICAL count in the PR description.

- [ ] **Step 2: Run every spec Definition-of-done check** from `docs/superpowers/specs/2026-10-15-spokes-design-system-design.md` and paste each command with its output into the PR description. Expected: each matches its stated result.

- [ ] **Step 3: Gates, push, review** as in Task 12 Steps 1 to 3 (title `feat: SPOKES polish: cards, header, progress, logo plate, Title Case`). The gallery "before" set is PR 3's after run.

- [ ] **Step 4: Update project memory.** In `.claude/MEMORY.md`, set Last Session to today's date and record which PRs merged, the screenshot artifact links, and anything Britt deferred. Add a Current Status line naming the SPOKES rollout as complete. Then confirm today's date is recorded:

```bash
sed -n '/## Last Session/,/## Open Items/p' .claude/MEMORY.md | head -3
```

Expected: the date line shows today's date.

- [ ] **Step 5: Commit and push** with Britt's OK.

```bash
git add .claude/MEMORY.md
git commit -m "docs: memory for the SPOKES design rollout"
```

PR 4, and the rollout, are done when Britt approves the final screenshots and merges.
