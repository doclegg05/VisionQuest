# Resume Builder — Live Preview + Font Picker — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming complete)
**Area:** Resume builder (`src/components/portfolio/ResumeBuilder.tsx` and `src/lib/resume*`)
**Author:** Brainstormed with Britt Legg

---

## Goal

Give SPOKES students an in-app **Edit ⇄ Preview** toggle so they see their formatted
resume as they build it, a **font dropdown** to choose how it looks, and make the
preview, the Print view, and the downloaded/attached PDF all render the **same way**.

Today the builder is data-complete but feedback-poor: students fill a long form and
only see a formatted result at Print/PDF time. Worse, the same resume renders three
different ways that do not match each other.

## Non-Goals

Each of these is a separate, future feature and is **out of scope** here:

- Resume templates / multiple resume versions
- Completeness or "strength" meter / guided wizard
- Changes to the AI assist ("Draft with Sage") behavior or its whole-resume overwrite
- Cover letters

## Context: the current state

`ResumeContent` (a Zod schema in `src/lib/resume.ts`) is the single source of truth for
resume **content**. It is stored as a JSON string in `ResumeData.data`.

The same content is rendered three different, divergent ways:

| Surface | Renderer | Look |
|---|---|---|
| Copy ATS Text | `buildResumePlainText` (`resume.ts`) | plain text |
| **Print** | `buildResumePrintHtml` (`resume.ts`) | Georgia **serif**, cream/navy |
| **Download PDF** | `generateResumePdf` (`resume-pdf.ts`, jsPDF) | Helvetica **sans-serif** |

`generateResumePdfArrayBuffer` runs in **two** places:

1. **Client** — the `Download PDF` button in `ResumeBuilder.tsx`.
2. **Server** — `src/app/api/resume/application-file/route.ts` generates the PDF,
   uploads it to storage, and creates a `FileUpload` (category `resume-generated`).
   This is how a student attaches their resume to a job application.

The server path is why we cannot rely on the browser's print-to-PDF, and why an
ATS-readable (selectable-text) PDF rules out image-based HTML→PDF.

## Decisions (from brainstorming)

1. **Live preview via Edit ⇄ Preview toggle tabs** — one panel, identical on phone and
   desktop. With tabs, "live" means the Preview tab is always current when opened; no
   keystroke-by-keystroke re-rendering is needed.
2. **The serif HTML look is canonical.**
3. **One visual spec, two synced renderers.** HTML renders preview + Print; jsPDF
   renders Download + server attach. They match by reading one shared layout spec, not
   by sharing a code path. Selectable text is preserved. No heavy new dependencies
   (no headless browser).
4. **Font picker** — a dropdown of four fonts, lazy-loaded.

## Architecture

```
        resume-layout.ts (NEW)  ── section order · titles · navy #16263f ·
        rule color · font sizes · RESUME_FONTS map (key → css + jsPDF)
                 │ consumed by
        ┌────────┴─────────┐
        ▼                  ▼
 buildResumePrintHtml   generateResumePdf (jsPDF)
   (serif HTML)         core fonts native · embedded fonts lazy-loaded
        │                  │
   Preview tab          Download PDF (client)
   (iframe srcDoc)      + server attach (/application-file)
   + Print window
```

`ResumeContent` (Zod) remains the source of truth for **content**. The new
`resume-layout.ts` becomes the source of truth for **appearance**. Both renderers read
it, so they cannot silently drift.

### Preview embedding

The Preview tab renders the exact HTML the Print button uses
(`buildResumePrintHtml`) inside a **sandboxed `<iframe srcDoc={...}>`**:

- Total style isolation — the resume's serif/cream CSS cannot leak into the app, and
  Tailwind cannot bleed into the resume.
- Pixel-identical to the Print view by construction.
- Scrolls fine on mobile; `sandbox` with no scripts.
- Re-renders from current `resume` state whenever the Preview tab is shown. No debounce
  needed (it is a tab, not a split view).

## Font system

Four fonts, default `times`. The `font` field is added to `ResumeContent`.

| Key | Font | Style | Cost |
|---|---|---|---|
| `times` *(default)* | Times New Roman | Serif | free (jsPDF core) |
| `arial` | Arial | Sans | free (jsPDF core) |
| `garamond` | EB Garamond | Serif | embedded (OFL), lazy |
| `lato` | Lato | Sans | embedded (OFL), lazy |

Rationale and constraints:

- **WYSIWYG cap.** Only Times (serif), Helvetica/Arial (sans), Courier (mono) render in
  jsPDF for free. Any other font must be embedded as a TTF.
- **Licensing.** Brand fonts (Georgia, Calibri, Garamond-the-Adobe-one) are proprietary
  and cannot be shipped. We use open-licensed (OFL) lookalikes: EB Garamond, Lato.
- **CSP.** The HTML side loads embedded fonts from Google Fonts, which is already
  whitelisted in the project CSP. jsPDF embeds the **same** TTF so preview = PDF.
- **Lazy loading.** jsPDF embeds the whole font file (no glyph subsetting) into every
  PDF that uses it. So embedded-font TTFs (and their jsPDF registration) load **only**
  when a student selects that font. The default path (`times`/`arial`) ships zero extra
  weight.

### `font` field — backward compatibility

`ResumeContent.font` is added with `.default("times").catch("times")`. Resumes saved
before this change (JSON without a `font` key) parse to `times`. **No DB migration** —
the field lives inside the existing `ResumeData.data` JSON string.

## Files

| File | Change |
|---|---|
| `src/lib/resume-layout.ts` | **NEW** — visual spec (section order, titles, colors, font sizes, spacing) + `RESUME_FONTS` map (key → `{ label, cssStack, jsPdfFont, kind, googleFamily? }`) |
| `src/lib/resume-fonts/` | **NEW** — lazy modules for the embedded fonts (EB Garamond + Lato, regular + bold) as base64 TTF, plus a jsPDF loader helper usable on client and server |
| `src/lib/resume.ts` | add `font` to `resumeContentSchema` + `normalizeResumeContent`; `buildResumePrintHtml` injects the selected font's CSS stack and a Google Fonts link, and reads colors/order/titles from the spec |
| `src/lib/resume-pdf.ts` | default font `helvetica`→`times`; select font per `resume.font` (core via `setFont`, embedded via lazy `addFont`); read colors/sizes/section order/titles from the spec |
| `src/components/portfolio/ResumeBuilder.tsx` | Edit/Preview tabs (ARIA `tablist`/`tab`/`tabpanel`, keyboard nav, 44px targets); Font dropdown in the header; Preview panel = sandboxed iframe; empty-state message; keep action buttons in a sticky header across both tabs |
| `src/app/api/resume/application-file/route.ts` | no change expected — the generator reads `resume.font` |
| tests | update `src/lib/resume.test.ts`, `src/lib/resume-pdf.test.ts`; add coverage for the layout spec, font selection, and the embedded-font load path |

## Accessibility (SPOKES)

- Real tab semantics: `role="tablist"` / `role="tab"` / `role="tabpanel"`,
  `aria-selected`, arrow-key navigation between tabs.
- Plain-language labels ("Edit" / "Preview"); labeled font dropdown.
- `title` attribute on the preview iframe for screen readers.
- WCAG-AA contrast; minimum 44×44px touch targets.

## Testing

- **Unit:** the layout spec is consumed by both renderers (each renderer's output
  contains the spec's section titles/order); font-key → css/jsPDF mapping.
- **Renderer:** `buildResumePrintHtml` output includes the selected font's CSS stack and
  Google Fonts link; `generateResumePdf` produces valid PDF bytes for both a core and an
  embedded font.
- **Component:** the Preview iframe `srcDoc` contains the student's name/headline and
  reflects the selected font; the empty-state shows when the resume is blank.
- **Gates:** `npx eslint .` and `npx prisma validate` pass (per project rules).
- **Manual:** confirm Preview matches Print; confirm Download PDF and the
  application-attachment PDF both render in the selected serif/sans font and match the
  preview's structure.

## Risks & sequencing

- **Main effort/risk: the embedded-font path.** Loading TTFs into jsPDF's virtual file
  system on **both** client and server, plus ~4 committed base64 TTF modules, is the
  bulk of the work and the spacing-sensitive part (Times/serif metrics differ from
  Helvetica, so a visual eyeball pass is required).
- **De-risk option.** The two free core fonts (`times`, `arial`) need none of the
  embedded-font machinery. If implementation gets heavy, the embedded pair
  (`garamond`, `lato`) can ship as a fast-follow **without reopening this design** —
  the `RESUME_FONTS` map is open, and the `font` field already tolerates unknown keys
  via `.catch`.
- **jsPDF restyle.** Change font/colors/sizes only; leave jsPDF's layout/cursor logic
  intact to limit blast radius.

## Out of band

- `.superpowers/` (visual-companion mockups) should be added to `.gitignore`.
- Branch hygiene: this work should land on its own branch, separate from the in-flight
  `feat/rag-pipeline` changes currently in the working tree.
