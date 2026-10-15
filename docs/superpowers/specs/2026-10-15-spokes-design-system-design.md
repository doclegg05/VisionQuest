# Design: VisionQuest on the SPOKES Design System

**Date:** 2026-10-15
**Status:** Design approved section by section in conversation; awaiting Britt's review of this written spec. The implementation plan follows at `PLAN`.
**Area:** `src/app/globals.css`, `src/app/layout.tsx`, `eslint.config.mjs`, every component that sets its own colors, `.impeccable.md`, `CLAUDE.md`
**Source of truth:** `SPOKES_ARTIFACT` (`project/README.md`, `project/tokens.json`, `project/components/bundle.css`). Where this spec and the artifact disagree, the artifact wins unless the decisions table under Solution lists an approved exception.
**Depends on:** HIG Phase 2 (draft PR #223, branch `fix/hig-phase-2`) merging to `main` first.

---

## Problem

VisionQuest serves SPOKES students and staff, but it doesn't look like a SPOKES product yet. The core palette already matches. Everything around it is off-brand:

- about 1,100 Tailwind color classes outside the SPOKES palette, about 390 of them in teacher components
- 15 component files with raw hex colors
- off-palette tokens in `globals.css` (error red, amber chat errors, purple and orange program badges, a dark theme built on `#0a1628`)
- Sora and Manrope fonts instead of DM Serif Display and Outfit
- corner, shadow, and motion values that differ from SPOKES tokens

Britt wants an official brand match. Students and teachers should see the same family as the SPOKES interactive lessons, and the palette and type rules in the SPOKES artifact are requirements, not suggestions.

## Solution

Rebuild VisionQuest's design tokens on SPOKES values. Then sweep every component onto those tokens behind a lint guard. Then restyle shared components to SPOKES patterns. Success means:

- every color VisionQuest renders comes from the SPOKES palette, at full strength or with transparency, and a test fails the build if one does not
- headings use DM Serif Display and everything else uses Outfit
- corners, shadows, motion, and the focus ring follow SPOKES tokens
- light and dark themes both pass WCAG AA for every documented text and background pair

The work ships as five draft PRs, each landing on its own:

1. 'Tokens' - rewrites `globals.css` and `layout.tsx` to SPOKES color, type, shape, and motion values (Design 2, 3, 4). Adds the palette and contrast tests and the lint rule (Design 6), and updates the docs (Design 8).
2. 'Student sweep' - moves student components onto role tokens with the codemod (Design 5).
3. 'Teacher sweep' - the same for teacher components.
4. 'Remaining sweep' - sign-in, admin, coordinator, routes, `src/lib` maps, and hand-fixed drawings and charts. Ends the lint rule's warn-only list.
5. 'Polish' - SPOKES card, header, progress, logo, and heading-case patterns (Design 7).

Decisions made during brainstorming:

| Decision | Choice |
|---|---|
| What "SPOKES Standards" means | Official brand match. Strict. |
| Dark mode | Keep it, rebuilt only from SPOKES colors |
| Exception 1 | Focus ring that passes contrast (SPOKES gold ring is 2.04:1 on white) |
| Exception 2 | Keep Phosphor icons (SPOKES has no icon set; labeled icons help low-literacy users) |
| Exception 3 | App-size type from the SPOKES mobile scale, not the 24px slide scale |
| Approach | Tokens first, then guarded sweeps by area, then component polish |
| Sequencing | Build after HIG Phase 2 merges, from `main` |
| Heading casing | Adopt SPOKES Title Case for page titles and card headings |

## Design

### 1. What already matches

- **Palette.** VisionQuest's core tokens already carry the SPOKES colors under the same names: `--primary #007baf`, `--accent #37b550`, `--dark #004071`, `--light #ffffff`, `--muted #edf3f7`, `--gold #d3b257`, `--royal #00133f`, `--mauve #a7253f`, `--offwhite #d1d3d4`, `--muted-gold #ad8806`.
- **Logo.** `public/spokes-logo.png` is the official mark and appears in `BrandLockup` and on the sign-in page.
- **Touch and contrast.** HIG Phase 1 put every control at 44px or more and raised light-theme text above 4.5:1.

### 2. Color and themes

#### 2.1 Allowed colors

The 11 SPOKES palette colors plus SPOKES `accent-text #1e7a2e`. Transparency of any of these is allowed. No other color may appear in `globals.css` or in component code. SPOKES's premium extension colors (`ink`, `cream`, `champagne`) stay out of scope.

`gray` follows the artifact: `#60636b` (6.01:1 on white). VisionQuest uses `#4a4d54` today. The artifact's published ratios match `#60636b`, so the artifact value wins.

#### 2.2 Light theme

| VisionQuest token | Today | SPOKES value |
|---|---|---|
| `--surface-base` (page) | `#f3f7f8` | `--muted` `#edf3f7` |
| `--surface-raised`, `--surface-soft` (cards) | white at 95% and 86% | `--light` `#ffffff`, solid |
| `--surface-muted` | `rgba(18,38,63,0.05)` | `--dark` at 5% |
| `--surface-overlay` | black at 4% | `--dark` at 4% |
| `--ink-strong` (headings, labels, key values) | `#00133f` | `--dark` `#004071` |
| `--ink-muted` (body and secondary text) | `#4a4d54` | `--gray` `#60636b` |
| `--ink-faint` (decoration only, never text) | black at 25% | `--dark` at 30% |
| `--border` (card hairlines) | `rgba(18,38,63,0.12)` | `--offwhite` `#d1d3d4` |
| `--border-control` (new: inputs, checkboxes, toggles) | none | `--gray` `#60636b` |
| `--accent-green`, `--success` | `#2a8a3c` | `--accent-text` `#1e7a2e` |
| `--accent-blue` | `#005d8a` | `--primary` `#007baf` |
| `--accent-red`, `--error` | `#c43c3c` | `--mauve` `#a7253f` |
| `--app-background` | gradient plus ambient lines | SPOKES `--grad-slide-bg`: `linear-gradient(170deg, var(--muted) 0%, var(--light) 50%, var(--offwhite) 100%)`. The ambient line pattern is removed. |
| `--paper-bg`, `--paper-margin` | `#fffdf2`, red at 20% | `--light`, `--mauve` at 20% |

Text color rule for light grounds: text may use `--dark`, `--gray`, `--royal`, `--mauve`, `--accent-text`, or `--primary`. `--primary` is allowed on white only, because it measures about 4.2:1 on `--muted`. Gold and bright green never carry text on light grounds. They appear as fills, dots, rules, and borders.

Chat tokens follow the same surfaces. The chat area is white and the sidebar is `--muted`. The user bubble is solid `--accent-text` with white text, replacing today's green gradient. The Sage mark is `--primary`, Sage actions are `--dark`, and the chat error banner uses the warning role.

#### 2.3 Dark theme

| Role | Value |
|---|---|
| Page | `--royal` `#00133f` |
| Cards and raised surfaces | `--dark` `#004071` |
| Strong text | `--light` |
| Body and secondary text | `--light` at 75% |
| Card hairlines | `--light` at 12% |
| Control borders | `--light` at 60% |
| Sticky bars | `--royal` at 82% with blur |

In the dark theme, gold passes as text on both grounds. Bright green and primary blue fall under 4.5:1 for body text on `--dark`, so they appear only as fills, dots, and borders, and the text beside them is white. The SPOKES logo sits on a white rounded plate whenever its ground is navy or royal, as the artifact requires.

#### 2.4 Status roles

The tokens PR adds role tokens and exposes them as Tailwind utilities (`bg-danger`, `bg-danger-soft`, `text-danger`, `border-danger`, and the same for each role). Components use roles, never hues.

| Role | Solid fill | Text on solid | Soft tint | Text color (light) | Text color (dark) | Border |
|---|---|---|---|---|---|---|
| `danger` | `--mauve` | `--light` | `--mauve` at 10% | `--mauve` | `--light` | `--mauve` |
| `success` | `--accent-text` | `--light` | `--accent` at 12% | `--accent-text` | `--light`, with a `--accent` dot | `--accent` |
| `warning` | `--gold` | `--dark` | `--gold` at 25% | `--dark`, with a `--muted-gold` dot | `--gold` | `--gold` |
| `info` | `--primary` | `--light` | `--primary` at 10% | `--dark` | `--light` | `--primary` |
| `brand-deep` | `--royal` | `--light` | `--royal` at 8% | `--royal` | `--light` | `--royal` |

Errors use the solid mauve pill in both themes so they read as the loudest state. Every status always carries a text label. Color is never the only signal.

#### 2.5 Program badges

Program badges keep their text labels.

- **SPOKES** uses the `info` soft tint with `--dark` text.
- **Adult Ed** uses the `brand-deep` soft tint with `--royal` text.
- **IETP** is an outlined pill: a `--muted-gold` border (3.3:1 on white, enough for a non-text border) with `--dark` text.

The three differ by fill versus outline as well as color, so they stay distinct for color-blind users.

#### 2.6 Buttons

- **Primary:** `--primary` fill with white text (4.72:1).
- **Positive** (save, download, submit): `--accent-text` fill with white text. SPOKES puts white text on `--accent #37b550`, which is 2.66:1 and fails. This spec corrects that one value.
- **Secondary:** transparent fill, `--dark` border and text.
- **Destructive:** the `danger` solid.

#### 2.7 Focus ring (approved exception)

SPOKES specifies `--focus-ring: 3px solid var(--gold)`, which is 2.04:1 on white and fails the 3:1 requirement for focus indicators.

- **Light theme:** a 2px `--dark` outline at 3px offset (10.65:1 on white), plus a 6px `--gold` halo at 55% that reads as SPOKES.
- **Dark theme:** a 2px solid `--gold` outline, which passes on both `--dark` and `--royal`.

#### 2.8 Charts and drawings

Chart series draw from one exported constant, `SPOKES_CHART_SERIES`, in this order: `--dark`, `--gold`, `--primary`, `--accent`, `--mauve`, `--gray`. The order puts neighbors at different lightness so adjacent series stay distinct without relying on hue.

The mountain progress graphic, corkboard, mood sparkline, region map, and signature pad are fixed by hand in the remaining sweep.

### 3. Type

**Fonts.** `next/font/google` loads `DM_Serif_Display` (weight 400, Latin) as `--font-display` and `Outfit` (variable weight) as `--font-body`. These replace `Sora` and `Manrope` in `src/app/layout.tsx`. The variable names do not change, so the 138 places that use the display font follow automatically.

**One weight for headings.** DM Serif Display ships only weight 400. Display text gets `font-synthesis-weight: none` so browsers never draw a smeared fake bold. The 15 class lists that pair the display font with `font-semibold` or `font-bold` lose the weight class during the sweeps. Headings use letter spacing `-0.01em` (SPOKES `ls-tight`) and line height 1.3 (`lh-heading`), or 1.1 (`lh-tight`) for display sizes. Body line height is 1.6 (`lh-body`).

**Scale (approved exception: app size, not slide size).** The tokens PR redefines Tailwind's text sizes in `@theme`, so every existing class moves to a SPOKES step without editing components. Each target is a SPOKES token.

| Class | Today | New size | SPOKES token | Uses on `main` |
|---|---|---|---|---|
| `text-xs` | 12px | 13px | `fs-m-footnote` | 1,103 |
| `text-sm` | 14px | 15px | `fs-m-subhead` | 1,519 |
| `text-base` | 16px | 17px | `fs-m-body` | 104 |
| `text-lg` | 18px | 17.6px | `fs-label` (1.1rem) | 86 |
| `text-xl` | 20px | 22px | `fs-m-title` | 33 |
| `text-2xl` | 24px | 28px | `fs-card-title` (1.75rem) | 121 |
| `text-3xl` | 30px | 34px | `fs-m-large-title` | 45 |
| `text-4xl` | 36px | 40px | `fs-h3` (2.5rem) | 7 |
| `text-5xl` | 48px | 56px | `fs-h2` (3.5rem) | 8 |

Remapping size names is legitimate because a size name promises a step on a scale. That is also why Design 5.1 rejects remapping color names: `text-red-600` promises red.

**Floor.** No student-facing text renders below 13px. The 12 uses of `text-[0.65rem]` (10.4px) move to `text-xs`, and the lint rule rejects arbitrary text sizes under 13px.

**Eyebrows.** Small uppercase labels use 13px, weight 700, letter spacing 2px (`fs-eyebrow` rounded up to the floor, `ls-eyebrow`).

### 4. Shape, depth, and motion

**Corners.** Tailwind radius names take SPOKES values in `@theme`: `sm` 6px, `md` 8px, `lg` 12px, `xl` 16px, `2xl` 20px, `3xl` 24px (`radius-pill`). `rounded-full` stays for circles and pills. The 73 arbitrary radii (`rounded-[1rem]`, `rounded-[1.2rem]`, `rounded-[1.15rem]` and others) move to the nearest named step during the sweeps. Spacing stays on Tailwind's 4px scale. SPOKES spacing tokens describe slide layout, and the only app spacing rule, the 44px hit area, is already met.

**Shadows.** Navy-tinted SPOKES values.

| VisionQuest token | SPOKES token | Value |
|---|---|---|
| `--shadow-card` | `shadow-md` | `0 4px 15px rgba(0, 64, 113, 0.08)` |
| `--shadow-card-lg` | `shadow-lg` | `0 8px 32px rgba(0, 64, 113, 0.08)` |
| `--shadow-premium` | `shadow-float` | `0 18px 50px -12px rgba(0, 19, 63, 0.35)` |
| `--shadow-premium-hover` | `shadow-hover` | `0 10px 30px rgba(0, 0, 0, 0.15)` |

Cards become solid surfaces. Backdrop blur stays only on sticky bars, using SPOKES `bar-bg` (`rgba(255, 255, 255, 0.82)` light, `--royal` at 82% dark).

**Motion.**

| VisionQuest token | Today | SPOKES |
|---|---|---|
| `--duration-fast` | 200ms | `dur-fast` 0.2s |
| `--duration-normal` | 450ms | `dur-base` 0.3s |
| `--duration-slow` | 800ms | `dur-slower` 0.8s |
| `--ease-smooth` | `cubic-bezier(0.4, 0, 0.2, 1)` | `ease-out` `cubic-bezier(0.25, 0.46, 0.45, 0.94)` |
| `--ease-spring`, `--ease-bounce` | two curves | `ease-spring` `cubic-bezier(0.68, -0.55, 0.265, 1.55)` |

Buttons lift 2px and gain a soft glow in their own fill color on hover, then settle to `scale(0.97)` on press. Cards lift 5px with `shadow-hover`. The existing `prefers-reduced-motion` block keeps all of it off.

### 5. The color sweep

#### 5.1 Mapping

| Tailwind hue | Role |
|---|---|
| red, rose, pink, fuchsia | `danger` |
| emerald, green, lime | `success` |
| amber, yellow, orange | `warning` |
| blue, sky, cyan, teal | `info`, or `primary` for interactive elements |
| indigo, violet, purple | `brand-deep` |
| slate, gray, zinc, neutral, stone | `ink-*`, `surface-*`, `border` tokens |

The shade picks the variant:

| Shade | Variant |
|---|---|
| 50 to 200 | soft tint (`bg-*-soft`) |
| 300 to 400 | border |
| 500 to 700 | solid fill (on `bg-`) or role text (on `text-`) |
| 800 and up | role text |

The table applies to `bg-`, `text-`, `fill-`, and `stroke-` classes. Any shade on `border-`, `ring-`, `outline-`, or `divide-` maps to the role's border token. Opacity suffixes carry over: `bg-red-500/10` becomes `bg-danger/10`.

Remapping Tailwind's color names to SPOKES colors in config was considered and rejected. It would make `text-red-600` render mauve, hide meaning from the next reader, and leave contrast between former shades unchecked.

#### 5.2 The codemod

- `scripts/lib/spokes-color-map.mjs` holds the mapping as a pure function, with unit tests in `scripts/lib/spokes-color-map.test.mjs`.
- `scripts/spokes-color-sweep.mjs --paths=<globs> [--write]` rewrites class strings in `.tsx` and `.ts` files, including the status-color maps in `src/lib`. Without `--write` it prints every change and changes nothing.
- Anything it cannot map with certainty goes on a printed hand-review list instead of being guessed: a hue inside a gradient, a computed or concatenated class name, an arbitrary value.

The student sweep does a few files by hand first, then runs the script on the same files and diffs the two results. The script is trusted only after that diff is empty.

#### 5.3 Order

1. **Student components:** orientation, portfolio, goals, career, certifications, jobs, vision board, Sage, LMS, documents, student and settings folders. About 25 files. Students see these, and the batch is small enough to prove the script.
2. **Teacher components:** 42 files, about 390 uses.
3. **Everything else:** sign-in, admin, coordinator, `src/app` routes, the remaining `src/lib` maps, and the 15 raw-hex files fixed by hand (Design 2.8).

### 6. Guards

1. **Palette test** (`src/app/globals.palette.test.ts`). Parses `globals.css` and fails on any color literal that is not an allowed color (Design 2.1) or a transparent form of one. It must be seen failing against today's file, which holds `#c43c3c` and others, before the token rewrite makes it pass.
2. **Contrast test** (`src/app/globals.contrast.test.ts`). Checks every pair named in Design 2.2 to 2.7 in both themes, compositing transparent colors over their ground. It requires 4.5:1 for text, and 3:1 for large text, control borders, and focus rings. It reuses `src/lib/wcag-contrast.ts` from HIG Phase 2.
3. **HIG Phase 2 token tests** (badge contrast, destructive, primary button) stay and must pass. If any of them pins a hex value rather than a ratio, the PR that changes it says so in its description. CI-enforced graders may be extended, never quietly relaxed.
4. **Lint rule** `spokes/no-off-palette-color`, defined as an inline plugin in `eslint.config.mjs`. It flags off-palette Tailwind hue classes, raw hex in component code, and arbitrary text sizes under 13px. It is an error everywhere except an `SPOKES_UNSWEPT` list of folders, where it warns. The tokens PR starts the list with every folder that has a violation on that day, so new folders are guarded from the start. Each sweep PR deletes its folders from the list, and the remaining sweep deletes the list.

   It is its own rule, not new `no-restricted-syntax` selectors. Flat config replaces that rule's options per block. A warn-level block for unswept folders would therefore also downgrade the existing student-log and `studentAlert` selectors in those folders.
5. **Runtime contrast.** A static test cannot know which ground a class lands on. The axe suites (`e2e/a11y.spec.ts`, and `e2e/a11y-authenticated.spec.ts` from HIG Phase 2) are the backstop on rendered pages.

### 7. Component polish

VisionQuest components are restyled to SPOKES. The SPOKES React bundle is not imported, because it targets 1280x720 slides and a `window` global.

- **Cards.** One treatment app-wide: white, `--border` hairline, `--shadow-card`, 12px corners. The SPOKES 6px left border (green, or gold for achievements) marks callouts only: tips, "Sage suggests", activity prompts. SPOKES rotates card styles per lesson chapter; an app keeps one look.
- **Page headers.** Eyebrow label, DM Serif title, and a 48px by 3px `--gold` rule underneath, matching the SPOKES title rule.
- **Progress bars.** SPOKES `--grad-progress` (`--primary` to `--gold`). The mountain metaphor stays and suits the logo.
- **Logo.** A white rounded plate behind the logo on navy and royal grounds.
- **Icons.** Phosphor stays (approved exception), colored with role and ink tokens only. No emoji.
- **Heading casing.** Page titles (`h1`) and card headings become Title Case, per SPOKES content rules. Buttons, labels, body copy, and Sage's generated text keep sentence case. Case does not change reading level, so the copy readability gate is unaffected.

### 8. Documentation

- `.impeccable.md`: fonts, color system, and surfaces rewritten to this spec, naming `SPOKES_ARTIFACT` as the source of truth and listing the three exceptions.
- `CLAUDE.md` design context: point at `SPOKES_ARTIFACT` alongside `.impeccable.md`.
- `.claude/agents/ux-reviewer.md` design system section: same update, so reviews check against SPOKES.
- `.claude/MEMORY.md`: decision-log rows for the strict brand match, the exceptions, and the corrections to SPOKES values (green button text, focus ring).

### 9. Out of scope

- SPOKES lesson pieces: WIPPEA badges, slide layouts, the lesson viewer, the premium editorial palette.
- Certificates (`src/lib/certificate-generator.ts`), email templates, and PDF exports. SPOKES has certificate and worksheet templates, so these are a natural follow-up spec.
- Replacing VisionQuest navigation with the SPOKES iOS components (`TabBar`, `NavBar`, `Sheet`). Existing navigation is restyled, not replaced.

### 10. Risks

- **Bigger text in dense teacher tables.** `text-xs` and `text-sm` each grow 1px, which can wrap or overflow table cells. The teacher sweep checks every table at 375px and 1280px and fixes layout where needed.
- **Serif headings in narrow spaces.** DM Serif Display sets wider than Sora. Long titles in cards may wrap to an extra line. The screenshot review catches this.
- **Lighter body text.** Body text moves from `#4a4d54` to `#60636b`. That still passes (6.01:1 on white, 5.37:1 on muted), but it reads lighter. If testing with students says otherwise, the fix is a request to change the SPOKES artifact, not a local override.
- **Conflicts with other branches.** The tokens PR touches `globals.css` and `layout.tsx`, which most UI branches also touch. Building after #223 removes the largest conflict. Other open branches rebase over the tokens PR.

### 11. Notes on the SPOKES source

These are inconsistencies inside the SPOKES artifact itself, recorded so whoever maintains it can fix them there:

- The focus ring (`3px solid var(--gold)`) fails WCAG 2.4.11 on light grounds.
- White text on the `accent` download button is 2.66:1.
- `--duotone-teal` in `components/bundle.css` uses `#0a9bb8`, which is outside the 11-color palette the README says is the only permitted set.

## Variables

- `WORKTREE`: `/Users/brittlegg/MacDev/companies/education/VisionQuest/.claude/worktrees/spokes-design` (branch `design/spokes-design-system`, then one branch per PR cut from it)
- `BASE`: `main`, after PR #223 merges
- `SPOKES_ARTIFACT`: https://claude.ai/artifact/5cF3cJB5x5K4qj4wb9G2dh
- `SPEC`: this file
- `PLAN`: `docs/superpowers/plans/2026-10-15-spokes-design-system.md`

## Workflow

1. **Plan.** After Britt approves `SPEC`, write `PLAN` with the `superpowers:writing-plans` skill. Build nothing before `PLAN` exists and Britt has picked how to execute it.
2. **Wait for the base.** Build starts only after #223 merges. Bring `WORKTREE` up to date with `BASE` first.
3. **Build in PR order.** Tokens, student sweep, teacher sweep, remaining sweep, polish. Each PR is a draft against `BASE`. Each passes its Definition of done checks before the next one starts.
4. **Verify.** Run every Definition of done check that applies to the PR, quote the output in the PR description, and publish the screenshot set for Britt's review. Report what passed, what failed, and what is blocked.
5. **Release.** Britt picks when the tokens PR deploys relative to class sessions. Teachers get a heads-up first.

## Deliverables

- `PLAN`
- Five draft PRs to `BASE`, as listed under Solution
- `src/app/globals.css` and `src/app/layout.tsx` on SPOKES values
- `src/app/globals.palette.test.ts` and `src/app/globals.contrast.test.ts`
- `scripts/lib/spokes-color-map.mjs`, `scripts/lib/spokes-color-map.test.mjs`, and `scripts/spokes-color-sweep.mjs`
- The `spokes/no-off-palette-color` rule in `eslint.config.mjs`
- Updated `.impeccable.md`, `CLAUDE.md`, `.claude/agents/ux-reviewer.md`, and `.claude/MEMORY.md`
- One published screenshot artifact per PR: both themes at 375px and 1280px for the student dashboard (Sage home), goals, orientation, portfolio, and career; the teacher queue and student detail; and sign-in

## Definition of done

### Palette

- `globals.css` holds only allowed colors.
  - Check: `node --import tsx --test src/app/globals.palette.test.ts`
    Expected: pass. The tokens PR description also quotes the same test failing against the pre-change file.
- No component code uses off-palette Tailwind hues.
  - Check: `git grep -nE '(bg|text|border|from|to|via|ring|fill|stroke|outline|divide|decoration|accent|caret)-(red|amber|yellow|orange|purple|violet|indigo|pink|rose|emerald|teal|cyan|sky|lime|fuchsia|green|blue|slate|gray|zinc|neutral|stone)-[0-9]{2,3}' -- 'src/**/*.tsx' 'src/**/*.ts'`
    Expected: no output, after the remaining sweep.
- No component code uses raw hex.
  - Check: `git grep -nE '#[0-9a-fA-F]{6}([^0-9a-fA-F]|$)' -- 'src/**/*.tsx'`
    Expected: no output, after the remaining sweep.

### Contrast

- Every documented pair passes in both themes.
  - Check: `node --import tsx --test src/app/globals.contrast.test.ts`
    Expected: pass.
- Rendered pages pass axe in CI.
  - Check: the PR's CI `e2e` job, which runs `e2e/a11y.spec.ts` and `e2e/a11y-authenticated.spec.ts` against CI's own database.
    Expected: passed on every PR.

### Type

- The SPOKES fonts replace the old ones.
  - Check: `grep -cE 'DM_Serif_Display|Outfit' src/app/layout.tsx; grep -cE 'Sora|Manrope' src/app/layout.tsx`
    Expected: 2 or more, then 0.
- No display text asks for a weight the font doesn't have.
  - Check: `git grep -nE 'font-display[^"]*font-(semibold|bold|extrabold)|font-(semibold|bold|extrabold)[^"]*font-display' -- 'src/**/*.tsx'`
    Expected: no output, after the remaining sweep.

### Lint guard

- The new rule fires, and the existing PII rules still fire beside it.
  - Check: create `src/components/spokes-probe.tsx` with `className="text-red-600"` and a `logger.info({ studentId })` call, run `npx eslint src/components/spokes-probe.tsx`, then delete the file.
    Expected: one `spokes/no-off-palette-color` error and one `no-restricted-syntax` error.
- The warn-only list is gone at the end.
  - Check: `grep -c SPOKES_UNSWEPT eslint.config.mjs`
    Expected: `0`, after the remaining sweep.

### Codemod

- The mapping is tested.
  - Check: `node --test scripts/lib/spokes-color-map.test.mjs`
    Expected: pass.
- The script matches hand work.
  - Check: the student sweep PR description.
    Expected: it quotes an empty diff between the hand-edited files and the script's output on the same files.

### Build

- Each PR passes the standard gates.
  - Check: `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit && npx eslint .` locally, and the PR's CI `verify` job.
    Expected: exit 0, and passed.

### Review

- The look is approved.
  - Check: Britt reviews the published screenshot artifact for each PR.
    Expected: approved.
- The polish PR is checked for usability.
  - Check: the `ux-reviewer` agent's report on the polish PR.
    Expected: no CRITICAL findings left open.

### Documentation

- Design docs point at the SPOKES artifact.
  - Check: `grep -c '5cF3cJB5x5K4qj4wb9G2dh' .impeccable.md CLAUDE.md .claude/agents/ux-reviewer.md`
    Expected: 1 or more for each file.
- The old fonts are gone from the design context.
  - Check: `grep -ciE 'sora|manrope' .impeccable.md`
    Expected: `0`.
- This spec reads as plain prose.
  - Check: `grep -c "$(printf '\342\200\224')" docs/superpowers/specs/2026-10-15-spokes-design-system-design.md` (the bytes of an em dash)
    Expected: `0`.
