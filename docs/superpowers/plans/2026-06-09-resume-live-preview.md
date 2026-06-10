# Resume Builder — Live Preview + Font Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Edit ⇄ Preview toggle and a font dropdown to the resume builder, and unify the HTML and PDF renderers onto one shared visual spec so the preview, Print, and downloaded/attached PDF all look the same.

**Architecture:** A new `resume-layout.ts` becomes the single source of truth for appearance (colors, section order, titles, font map). `buildResumePrintHtml` (preview + Print) and `generateResumePdf` (download + server attach) both read from it. A `font` field is added to the existing `ResumeContent` JSON (no DB migration). Core fonts (Times, Arial) work natively in jsPDF; embedded fonts (EB Garamond, Lato) lazy-load TTFs on both client and server.

**Tech Stack:** Next.js 16, TypeScript, Zod 4, jsPDF 4, Tailwind 4, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-06-09-resume-live-preview-design.md`

**Sequencing:** Phases 0–3 deliver a fully shippable feature with the two free fonts. Phase 4 (embedded fonts) is an independent fast-follow that can be deferred without reopening the design. Phase 5 is the final gate.

---

## File Structure

```
src/lib/
  resume-layout.ts            # CREATE — visual spec + RESUME_FONTS map (source of truth for appearance)
  resume-layout.test.ts       # CREATE — spec + font-map tests
  resume.ts                   # MODIFY — add `font` to schema; buildResumePrintHtml reads spec + font
  resume.test.ts              # MODIFY — font field + print-html font tests
  resume-pdf.ts               # MODIFY — read spec; select font per resume.font
  resume-pdf.test.ts          # MODIFY — per-font PDF tests
  resume-fonts/               # CREATE (Phase 4) — embedded-font loader + base64 TTF modules
    index.ts
    index.test.ts
    eb-garamond-regular.ts    # generated base64
    eb-garamond-bold.ts       # generated base64
    lato-regular.ts           # generated base64
    lato-bold.ts              # generated base64

src/components/portfolio/
  ResumeBuilder.tsx           # MODIFY — Edit/Preview tabs, font dropdown, preview iframe, empty-state

scripts/
  build-resume-fonts.mjs      # CREATE (Phase 4) — encode local TTFs → base64 .ts modules
```

**Test commands (use these throughout):**
- Single file: `npx tsx --test --experimental-test-module-mocks <path>.test.ts`
- Lint a path: `npx eslint <path>`
- Schema: `npx prisma validate`

---

## Phase 0 — Shared visual spec

### Task 1: Create `resume-layout.ts` (appearance source of truth)

**Files:**
- Create: `src/lib/resume-layout.ts`
- Test: `src/lib/resume-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/resume-layout.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import {
  RESUME_FONTS,
  RESUME_FONT_KEYS,
  DEFAULT_RESUME_FONT,
  getResumeFont,
  RESUME_SECTION_ORDER,
  RESUME_SECTION_TITLES,
} from "@/lib/resume-layout";

test("RESUME_FONT_KEYS includes the four supported fonts", () => {
  assert.deepEqual([...RESUME_FONT_KEYS], ["times", "arial", "garamond", "lato"]);
});

test("default font is times and is a core font", () => {
  assert.equal(DEFAULT_RESUME_FONT, "times");
  assert.equal(RESUME_FONTS.times.kind, "core");
  assert.equal(RESUME_FONTS.times.jsPdfFont, "times");
});

test("getResumeFont falls back to default on unknown/empty key", () => {
  assert.equal(getResumeFont("nope").key, "times");
  assert.equal(getResumeFont(null).key, "times");
  assert.equal(getResumeFont("lato").key, "lato");
});

test("embedded fonts carry a googleFamily for the HTML side", () => {
  assert.equal(RESUME_FONTS.garamond.kind, "embedded");
  assert.ok(RESUME_FONTS.garamond.googleFamily);
  assert.ok(RESUME_FONTS.lato.googleFamily);
});

test("every section in the order has a title", () => {
  for (const id of RESUME_SECTION_ORDER) {
    assert.ok(RESUME_SECTION_TITLES[id], `missing title for ${id}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume-layout.test.ts`
Expected: FAIL — cannot find module `@/lib/resume-layout`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/resume-layout.ts`:

```typescript
/**
 * Single source of truth for resume APPEARANCE.
 * Both renderers (buildResumePrintHtml + generateResumePdf) read from this module
 * so the preview, Print view, and downloaded/attached PDF cannot drift.
 */

export const RESUME_FONT_KEYS = ["times", "arial", "garamond", "lato"] as const;
export type ResumeFontKey = (typeof RESUME_FONT_KEYS)[number];

export interface ResumeFont {
  key: ResumeFontKey;
  label: string;
  /** font-family stack for the HTML renderer */
  cssStack: string;
  /** font name registered in jsPDF (built-in for core, addFont name for embedded) */
  jsPdfFont: string;
  kind: "core" | "embedded";
  /** Google Fonts family query (HTML side) — embedded fonts only */
  googleFamily?: string;
}

export const RESUME_FONTS: Record<ResumeFontKey, ResumeFont> = {
  times: {
    key: "times",
    label: "Times New Roman",
    cssStack: `"Times New Roman", Times, serif`,
    jsPdfFont: "times",
    kind: "core",
  },
  arial: {
    key: "arial",
    label: "Arial",
    cssStack: `Arial, Helvetica, sans-serif`,
    jsPdfFont: "helvetica",
    kind: "core",
  },
  garamond: {
    key: "garamond",
    label: "EB Garamond",
    cssStack: `"EB Garamond", Georgia, serif`,
    jsPdfFont: "EBGaramond",
    kind: "embedded",
    googleFamily: "EB+Garamond:wght@400;700",
  },
  lato: {
    key: "lato",
    label: "Lato",
    cssStack: `"Lato", Arial, sans-serif`,
    jsPdfFont: "Lato",
    kind: "embedded",
    googleFamily: "Lato:wght@400;700",
  },
};

export const DEFAULT_RESUME_FONT: ResumeFontKey = "times";

export function getResumeFont(key: string | null | undefined): ResumeFont {
  if (key && (RESUME_FONT_KEYS as readonly string[]).includes(key)) {
    return RESUME_FONTS[key as ResumeFontKey];
  }
  return RESUME_FONTS[DEFAULT_RESUME_FONT];
}

/** Section identity, order, and headings — shared by both renderers. */
export const RESUME_SECTION_ORDER = [
  "summary",
  "skills",
  "experience",
  "education",
  "certifications",
  "references",
] as const;

export const RESUME_SECTION_TITLES: Record<string, string> = {
  summary: "Professional Summary",
  skills: "Skills",
  experience: "Experience",
  education: "Education",
  certifications: "Certifications",
  references: "References",
};

/** Colors — hex for HTML/CSS, rgb tuples for jsPDF setTextColor/setDrawColor. */
export const RESUME_COLORS = { ink: "#16263f", inkSoft: "#48566b", rule: "#9ca7b6" } as const;
export const RESUME_RGB = {
  ink: [22, 38, 63] as const,
  inkSoft: [72, 86, 107] as const,
  rule: [156, 167, 182] as const,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume-layout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint**

Run: `npx eslint src/lib/resume-layout.ts src/lib/resume-layout.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/resume-layout.ts src/lib/resume-layout.test.ts
git commit -m "feat: add resume-layout visual spec and font map"
```

---

## Phase 1 — Schema: `font` field

### Task 2: Add `font` to `ResumeContent`

**Files:**
- Modify: `src/lib/resume.ts` (the `resumeContentSchema` block near lines 51-66, and `normalizeResumeContent` near lines 135-158)
- Test: `src/lib/resume.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/resume.test.ts`:

```typescript
test("resume content defaults font to times and is backward compatible", () => {
  // Old saved resume JSON had no `font` key
  const parsed = normalizeResumeContent({ headline: "Office Assistant" });
  assert.equal(parsed.font, "times");
});

test("resume content keeps a valid font and rejects an invalid one", () => {
  assert.equal(normalizeResumeContent({ font: "lato" }).font, "lato");
  assert.equal(normalizeResumeContent({ font: "comic-sans" }).font, "times");
});
```

(Existing `resume.test.ts` already imports `normalizeResumeContent`; confirm the import line is present — if not, add `import { normalizeResumeContent } from "@/lib/resume";`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume.test.ts`
Expected: FAIL — `parsed.font` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/resume.ts`, add the import at the top (after the `zod` import):

```typescript
import { RESUME_FONT_KEYS, DEFAULT_RESUME_FONT } from "@/lib/resume-layout";
```

Add the `font` field to `resumeContentSchema` (inside the `z.object({ ... })`, after `references`):

```typescript
  font: z.enum(RESUME_FONT_KEYS).catch(DEFAULT_RESUME_FONT).default(DEFAULT_RESUME_FONT),
```

In `normalizeResumeContent`, add `font` to the object passed to `resumeContentSchema.parse({ ... })` (alongside `references: raw.references`):

```typescript
    font: raw.font,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume.test.ts`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Lint**

Run: `npx eslint src/lib/resume.ts src/lib/resume.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/resume.ts src/lib/resume.test.ts
git commit -m "feat: add font field to resume content schema (default times)"
```

---

## Phase 2 — Renderers read the spec + selected font (core fonts)

### Task 3: `buildResumePrintHtml` honors the font

**Files:**
- Modify: `src/lib/resume.ts` (`buildResumePrintHtml`, near lines 269-451)
- Test: `src/lib/resume.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/resume.test.ts`:

```typescript
import { buildResumePrintHtml } from "@/lib/resume";

test("print HTML uses the selected core font and no Google Fonts link", () => {
  const html = buildResumePrintHtml("Maria Sanchez", normalizeResumeContent({ font: "arial", headline: "Office" }));
  assert.ok(html.includes("Arial, Helvetica, sans-serif"));
  assert.ok(!html.includes("fonts.googleapis.com"));
});

test("print HTML injects a Google Fonts link for an embedded font", () => {
  const html = buildResumePrintHtml("Maria Sanchez", normalizeResumeContent({ font: "garamond" }));
  assert.ok(html.includes("fonts.googleapis.com"));
  assert.ok(html.includes("EB+Garamond"));
  assert.ok(html.includes(`"EB Garamond", Georgia, serif`));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume.test.ts`
Expected: FAIL — current HTML hardcodes a Georgia/serif body font; no Google Fonts link.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/resume.ts`, extend the import added in Task 2:

```typescript
import { RESUME_FONT_KEYS, DEFAULT_RESUME_FONT, getResumeFont } from "@/lib/resume-layout";
```

At the top of `buildResumePrintHtml`, before building the HTML string:

```typescript
  const font = getResumeFont(resume.font);
  const fontLink = font.googleFamily
    ? `<link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=${font.googleFamily}&display=swap" rel="stylesheet" />`
    : "";
```

In the `<head>`, add `${fontLink}` immediately after the `<title>...</title>` line.

Replace the body `font-family` declaration (currently `font-family: Georgia, "Times New Roman", serif;`) with:

```css
        font-family: ${font.cssStack};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `npx eslint src/lib/resume.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/resume.ts src/lib/resume.test.ts
git commit -m "feat: render resume print HTML in the selected font"
```

---

### Task 4: `generateResumePdf` selects the font (core fonts) + reads spec colors

**Files:**
- Modify: `src/lib/resume-pdf.ts`
- Test: `src/lib/resume-pdf.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/resume-pdf.test.ts`. These assert the actual base-font name embedded in the PDF bytes (jsPDF writes `Times-Roman`/`Helvetica` etc. into the font resources), so they are genuinely red before the font is honored:

```typescript
test("default resume PDF uses the Times base font", async () => {
  const resume = normalizeResumeContent({ headline: "Office Assistant", skills: ["Scheduling"] });
  const buffer = await generateResumePdfArrayBuffer("Test Student", resume);
  const pdf = Buffer.from(buffer).toString("latin1");
  assert.match(pdf, /Times/);
});

test("arial resume PDF uses the Helvetica base font", async () => {
  const resume = normalizeResumeContent({ headline: "Office Assistant", font: "arial", skills: ["Scheduling"] });
  const buffer = await generateResumePdfArrayBuffer("Test Student", resume);
  const pdf = Buffer.from(buffer).toString("latin1");
  assert.match(pdf, /Helvetica/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume-pdf.test.ts`
Expected: FAIL on "default resume PDF uses the Times base font" — the generator currently hardcodes `helvetica`, so the default-font PDF contains `Helvetica`, not `Times`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/resume-pdf.ts`, add imports at the top:

```typescript
import { getResumeFont, RESUME_RGB, type ResumeFont } from "@/lib/resume-layout";
```

Add a style helper near the top of the file (after the imports):

```typescript
/**
 * jsPDF throws if a font/style pair was never registered. Core fonts have
 * italic; embedded fonts here register only normal + bold, so fall italic → normal.
 */
function fontStyle(font: ResumeFont, style: "normal" | "bold" | "italic"): string {
  if (style === "italic" && font.kind === "embedded") return "normal";
  return style;
}
```

In `generateResumePdfArrayBuffer`, after `const doc = new jsPDF({...})`, resolve the font and replace the hardcoded color/font usage:

```typescript
  const font = getResumeFont(resume.font);
```

Then, throughout the function, replace every `doc.setFont("helvetica", X)` with `doc.setFont(font.jsPdfFont, fontStyle(font, X))`, and replace the color calls:
- `doc.setTextColor(18, 38, 63)` and `doc.setTextColor(22, 38, 63)` → `doc.setTextColor(...RESUME_RGB.ink)`
- `doc.setDrawColor(160, 172, 188)` → `doc.setDrawColor(...RESUME_RGB.rule)`

Also update `drawSectionTitle` to take and use the font. Change its signature to `drawSectionTitle(doc, title, cursor, font)` and inside it use `doc.setFont(font.jsPdfFont, "bold")` and `doc.setTextColor(...RESUME_RGB.ink)` / `doc.setDrawColor(...RESUME_RGB.rule)`. Update its call sites to pass `font`.

(Leave all cursor math, sizes, and section logic unchanged — font/color swap only.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume-pdf.test.ts`
Expected: PASS (existing 2 tests + new arial test).

- [ ] **Step 5: Lint**

Run: `npx eslint src/lib/resume-pdf.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/resume-pdf.ts src/lib/resume-pdf.test.ts
git commit -m "feat: render resume PDF in the selected core font from shared spec"
```

---

## Phase 3 — UI: tabs, font dropdown, live preview

> No React test harness exists in this repo (tests are lib-only `*.test.ts`). These tasks are verified manually in the browser; the rendering logic they depend on is already covered by the lib tests above.

### Task 5: Edit ⇄ Preview tabs + preview iframe + empty-state

**Files:**
- Modify: `src/components/portfolio/ResumeBuilder.tsx`

- [ ] **Step 1: Add tab state and the preview helper**

In `src/components/portfolio/ResumeBuilder.tsx`, add to the imports from `@/lib/resume` (it already imports `buildResumePrintHtml`):

```typescript
import { isResumeEmpty } from "@/lib/resume";
```

Add state near the other `useState` hooks (after `const [dragOver, setDragOver] = useState(false);`):

```typescript
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");
```

- [ ] **Step 2: Add the tab bar above the section cards**

Immediately after the closing `</div>` of the top header `surface-section` block (the one containing the action buttons, around line 415) and before the Upload card, insert a tablist:

```tsx
      <div
        role="tablist"
        aria-label="Resume editor view"
        className="flex gap-1 rounded-xl bg-[var(--surface-soft)] p-1"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            setActiveTab((t) => (t === "edit" ? "preview" : "edit"));
          }
        }}
      >
        {(["edit", "preview"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => setActiveTab(tab)}
            className={`min-h-[44px] flex-1 rounded-lg px-4 text-sm font-semibold transition ${
              activeTab === tab
                ? "bg-white text-[var(--accent-strong)] shadow-sm"
                : "text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
            }`}
          >
            {tab === "edit" ? "Edit" : "Preview"}
          </button>
        ))}
      </div>
```

- [ ] **Step 3: Wrap the editing cards and add the preview panel**

Wrap all the existing editing cards (Upload card, Write-with-Sage card, Header, Summary, Skills, Experience, Education, Certifications, References, and the final Save button) in a panel that only shows on the Edit tab. Add the preview panel for the Preview tab.

Put this immediately after the tablist:

```tsx
      {activeTab === "preview" ? (
        <div role="tabpanel" aria-label="Resume preview" className="surface-section p-3">
          {isResumeEmpty(resume) ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-16 text-center">
              <p className="text-sm font-medium text-[var(--ink-strong)]">Your resume is empty</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Switch to <span className="font-semibold">Edit</span> and add your details — they’ll show up here.
              </p>
            </div>
          ) : (
            <iframe
              title="Resume preview"
              sandbox=""
              className="h-[80vh] w-full rounded-lg border border-[var(--border)] bg-white"
              srcDoc={buildResumePrintHtml(displayName || "Resume", resume)}
            />
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="Resume editor" className="space-y-6">
          {/* existing editing cards move inside here */}
        </div>
      )}
```

Move the existing editing cards (Upload through the final full-width Save button) inside the `else` branch's `<div role="tabpanel" ...>`. Keep the top header `surface-section` (name + action buttons + error) ABOVE the tablist so Copy/Download/Print/Save stay visible on both tabs.

- [ ] **Step 4: Verify manually**

Run: `npm run dev`, open the student Portfolio → Resume, and check:
- The `Edit` / `Preview` tabs appear; arrow keys switch them; both are ≥44px tall.
- `Preview` shows the formatted resume matching the Print output; empty resume shows the empty-state.
- Action buttons remain visible on both tabs.

Run: `npx eslint src/components/portfolio/ResumeBuilder.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/portfolio/ResumeBuilder.tsx
git commit -m "feat: add Edit/Preview tabs with live resume preview"
```

---

### Task 6: Font dropdown

**Files:**
- Modify: `src/components/portfolio/ResumeBuilder.tsx`

- [ ] **Step 1: Import the font list**

Add to `ResumeBuilder.tsx` imports:

```typescript
import { RESUME_FONTS, RESUME_FONT_KEYS, type ResumeFontKey } from "@/lib/resume-layout";
```

- [ ] **Step 2: Add the dropdown to the header**

Inside the top header `surface-section`, in the action-buttons row (the `<div className="flex flex-wrap gap-2">`), add as the first child:

```tsx
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">Resume font</span>
              <select
                aria-label="Resume font"
                value={resume.font}
                onChange={(event) =>
                  setResume((current) => ({ ...current, font: event.target.value as ResumeFontKey }))
                }
                className="min-h-[44px] rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-medium text-[var(--ink-strong)]"
              >
                {RESUME_FONT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {RESUME_FONTS[key].label}
                  </option>
                ))}
              </select>
            </label>
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev`, open Resume, change the font dropdown, switch to Preview — the preview re-renders in the chosen font (Times/Arial immediately). Save, reload — the font persists.

Run: `npx eslint src/components/portfolio/ResumeBuilder.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/portfolio/ResumeBuilder.tsx
git commit -m "feat: add resume font picker dropdown"
```

> **Shippable checkpoint:** With Phases 0–3 done, the live preview + font picker work end-to-end for Times and Arial across preview, Print, Download, and application-attachment PDFs. Phase 4 adds the two embedded fonts.

---

## Phase 4 — Embedded fonts (EB Garamond, Lato) — fast-follow

> This phase adds the two embedded fonts. It requires obtaining **static-weight** TTF files (regular + 700). Note: EB Garamond on Google Fonts is a *variable* font; jsPDF needs a static instance — use a static build (e.g. from the `@fontsource/eb-garamond` package's `files/*.ttf`, or a static instance exported from Font Squirrel / fonttools). Lato ships static TTFs in `google/fonts` (`ofl/lato/Lato-Regular.ttf`, `Lato-Bold.ttf`).

### Task 7: Font build script + base64 modules

**Files:**
- Create: `scripts/build-resume-fonts.mjs`
- Create (generated): `src/lib/resume-fonts/eb-garamond-regular.ts`, `eb-garamond-bold.ts`, `lato-regular.ts`, `lato-bold.ts`

- [ ] **Step 1: Create the build script**

Create `scripts/build-resume-fonts.mjs`:

```javascript
// Encodes static TTF files into base64 TS modules for jsPDF embedding.
// Place the four TTFs in scripts/_fonts-src/ with these exact names, then run:
//   node scripts/build-resume-fonts.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "scripts", "_fonts-src");
const outDir = join(root, "src", "lib", "resume-fonts");

const FILES = [
  ["EBGaramond-Regular.ttf", "eb-garamond-regular.ts"],
  ["EBGaramond-Bold.ttf", "eb-garamond-bold.ts"],
  ["Lato-Regular.ttf", "lato-regular.ts"],
  ["Lato-Bold.ttf", "lato-bold.ts"],
];

for (const [ttf, out] of FILES) {
  const ttfPath = join(srcDir, ttf);
  if (!existsSync(ttfPath)) {
    console.error(`MISSING: ${ttfPath}`);
    process.exitCode = 1;
    continue;
  }
  const base64 = readFileSync(ttfPath).toString("base64");
  writeFileSync(join(outDir, out), `// Generated by scripts/build-resume-fonts.mjs — do not edit.\nexport default ${JSON.stringify(base64)};\n`);
  console.log(`wrote ${out} (${base64.length} chars)`);
}
```

- [ ] **Step 2: Obtain the TTFs and generate the modules**

Place the four static TTFs in `scripts/_fonts-src/` (named exactly as in the script), then run:

```bash
node scripts/build-resume-fonts.mjs
```

Expected: four `wrote ...` lines and the four `.ts` modules created under `src/lib/resume-fonts/`.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-resume-fonts.mjs src/lib/resume-fonts/eb-garamond-regular.ts src/lib/resume-fonts/eb-garamond-bold.ts src/lib/resume-fonts/lato-regular.ts src/lib/resume-fonts/lato-bold.ts
git commit -m "chore: add embedded resume font modules (EB Garamond, Lato)"
```

---

### Task 8: jsPDF embedded-font loader (client + server)

**Files:**
- Create: `src/lib/resume-fonts/index.ts`
- Test: `src/lib/resume-fonts/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/resume-fonts/index.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import jsPDF from "jspdf";
import { ensureEmbeddedFont } from "@/lib/resume-fonts";

test("ensureEmbeddedFont returns false for a core font", async () => {
  const doc = new jsPDF();
  assert.equal(await ensureEmbeddedFont(doc, "times"), false);
});

test("ensureEmbeddedFont registers an embedded font and is idempotent", async () => {
  const doc = new jsPDF();
  assert.equal(await ensureEmbeddedFont(doc, "lato"), true);
  // second call short-circuits without throwing
  assert.equal(await ensureEmbeddedFont(doc, "lato"), true);
  doc.setFont("Lato", "bold");
  doc.text("Hello", 10, 10);
  const bytes = doc.output("arraybuffer");
  assert.ok(bytes.byteLength > 1000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume-fonts/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/resume-fonts/index.ts`:

```typescript
import type jsPDF from "jspdf";
import type { ResumeFontKey } from "@/lib/resume-layout";

interface EmbeddedFont {
  family: string;
  vfsNormal: string;
  vfsBold: string;
  load: () => Promise<{ normal: string; bold: string }>;
}

const EMBEDDED: Partial<Record<ResumeFontKey, EmbeddedFont>> = {
  garamond: {
    family: "EBGaramond",
    vfsNormal: "EBGaramond-Regular.ttf",
    vfsBold: "EBGaramond-Bold.ttf",
    load: async () => {
      const [n, b] = await Promise.all([
        import("./eb-garamond-regular"),
        import("./eb-garamond-bold"),
      ]);
      return { normal: n.default, bold: b.default };
    },
  },
  lato: {
    family: "Lato",
    vfsNormal: "Lato-Regular.ttf",
    vfsBold: "Lato-Bold.ttf",
    load: async () => {
      const [n, b] = await Promise.all([import("./lato-regular"), import("./lato-bold")]);
      return { normal: n.default, bold: b.default };
    },
  },
};

const registered = new WeakMap<jsPDF, Set<ResumeFontKey>>();

/**
 * Registers an embedded font's normal + bold faces into a jsPDF document's
 * virtual filesystem. Returns false for core fonts (nothing to do).
 * Idempotent per (doc, font). Works on both client and server.
 */
export async function ensureEmbeddedFont(doc: jsPDF, key: ResumeFontKey): Promise<boolean> {
  const font = EMBEDDED[key];
  if (!font) return false;

  const done = registered.get(doc) ?? new Set<ResumeFontKey>();
  if (done.has(key)) return true;

  const { normal, bold } = await font.load();
  doc.addFileToVFS(font.vfsNormal, normal);
  doc.addFont(font.vfsNormal, font.family, "normal");
  doc.addFileToVFS(font.vfsBold, bold);
  doc.addFont(font.vfsBold, font.family, "bold");

  done.add(key);
  registered.set(doc, done);
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume-fonts/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `npx eslint src/lib/resume-fonts/`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/resume-fonts/index.ts src/lib/resume-fonts/index.test.ts
git commit -m "feat: add jsPDF embedded-font loader for resume fonts"
```

---

### Task 9: Wire embedded fonts into the PDF generator

**Files:**
- Modify: `src/lib/resume-pdf.ts`
- Test: `src/lib/resume-pdf.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/resume-pdf.test.ts`:

```typescript
test("generates PDF bytes for an embedded font (garamond)", async () => {
  const resume = normalizeResumeContent({ headline: "Office Assistant", font: "garamond", skills: ["Filing"] });
  const buffer = await generateResumePdfArrayBuffer("Test Student", resume);
  const header = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 4)));
  assert.equal(header, "%PDF");
  assert.ok(buffer.byteLength > 1000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume-pdf.test.ts`
Expected: FAIL — `doc.setFont("EBGaramond", ...)` throws "Unable to look up font label" because the font is not registered yet.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/resume-pdf.ts`, add the import:

```typescript
import { ensureEmbeddedFont } from "@/lib/resume-fonts";
```

In `generateResumePdfArrayBuffer`, immediately after `const font = getResumeFont(resume.font);` (added in Task 4):

```typescript
  await ensureEmbeddedFont(doc, font.key);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/resume-pdf.test.ts`
Expected: PASS (all per-font tests).

- [ ] **Step 5: Lint**

Run: `npx eslint src/lib/resume-pdf.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/resume-pdf.ts src/lib/resume-pdf.test.ts
git commit -m "feat: embed selected resume font into generated PDF"
```

---

### Task 10: Verify embedded fonts end-to-end in the UI

**Files:** none (verification only)

- [ ] **Step 1: Manual verification**

Run: `npm run dev`, open Resume:
- Select **EB Garamond** → Preview re-renders in Garamond (Google Fonts loads via CSP allowlist); **Download PDF** produces a Garamond PDF with selectable text (copy a line from the PDF to confirm it is text, not an image).
- Repeat for **Lato**.
- Confirm the first paint with the default font did **not** request the embedded font files (Network tab) — they load only on selection.

- [ ] **Step 2: Verify the server-attached PDF**

Trigger the application attach flow (`POST /api/resume/application-file`) for a resume whose `font` is `garamond`; confirm the stored PDF renders in Garamond. (If the UI path isn't reachable, call the route directly while logged in.)

---

## Phase 5 — Final gate

### Task 11: Full suite + lint + schema + manual checklist

**Files:** none (verification only)

- [ ] **Step 1: Run the resume test suite**

Run:
```bash
npx tsx --test --experimental-test-module-mocks src/lib/resume.test.ts src/lib/resume-layout.test.ts src/lib/resume-pdf.test.ts src/lib/resume-fonts/index.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Lint + schema gates**

Run:
```bash
npx eslint .
npx prisma validate
```
Expected: no eslint errors; "The schema at prisma/schema.prisma is valid." (Schema unchanged — sanity check.)

- [ ] **Step 3: Manual WYSIWYG checklist**

For each font (Times, Arial, Garamond, Lato): Preview, Print, and Download PDF show the **same** look; switching tabs keeps content; empty-state shows for a blank resume; action buttons visible on both tabs; keyboard tab switching works.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test: resume live preview + font picker verification fixups"
```

---

## Notes for the executor

- **Branch:** create a dedicated branch off `main` before Task 1 (e.g. `feat/resume-live-preview`). Do not mix with the in-flight `feat/rag-pipeline` working-tree changes.
- **`.gitignore`:** ensure `.superpowers/` is ignored (brainstorm mockups) — add it if missing.
- **No DB migration** is part of this plan. If you find yourself editing `prisma/schema.prisma`, stop — the `font` field lives in the `ResumeData.data` JSON, not a column.
- **Secrets:** these files touch no secrets; still run the project's pre-commit secret scan if configured.
