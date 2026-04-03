# Orientation Wizard Design Spec

**Date:** 2026-04-02
**Status:** Approved
**Branch:** feat/phase1-goal-reliability

---

## Problem

The current orientation flow requires 5-6 steps per document: click checkbox → expand → click "Open PDF" (new tab) → read → go back → sign → repeat. With 15+ forms this is tedious. Additionally:

1. **Broken file links** — PDFs exist in `content/` but the download API looks in `docs-upload/` and `uploads/`, neither of which exist. All "Open PDF" links return 404.
2. **Signature canvas clips** — Fixed 500px width overflows narrow containers; `overflow-hidden` on parent clips the canvas, cutting off signatures halfway.
3. **Post-completion clutter** — Orientation tab stays in nav permanently even after completion.

## Solution

Replace the current checklist-with-popups with a **full-page stepper wizard** that presents one document at a time with inline PDF viewing, responsive signature capture (draw or type), and auto-archives the orientation tab on completion.

---

## Approved Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Full-page stepper | Maximum PDF space, simplest mental model, one thing at a time |
| Signature | Draw or Type toggle | Draw feels personal; type handles accessibility/trackpad issues; both legally valid |
| Completion | Celebration summary + redirect | Orientation is a milestone — deserves a moment; summary builds trust |
| Post-completion | Remove orientation from student nav | Reduces clutter; teacher side unchanged; tab reappears if signature rejected |
| PDF viewer | iframe with native browser PDF | No new dependencies; works great on desktop (primary device) |
| Read gate | "I have read this document" checkbox | Can't detect scroll inside iframe; checkbox is honest and simple |
| Non-signature forms | PDF + "I've read this" button | No signature pad; clicking advances to next step |
| Read-only forms | PDF + "Continue" button | No acknowledgment required for informational docs |

---

## Architecture

### Component Tree

```
OrientationWizard (new page-level component)
├── WizardStepIndicator
│   └── Horizontal step dots + "Document 3 of 8 — Dress Code Policy"
├── WizardDocumentViewer
│   └── iframe pointing to /api/forms/download?formId={id}&mode=view
├── WizardSignatureArea (for requiresSignature forms)
│   ├── Draw/Type tab toggle
│   ├── SignaturePad (responsive canvas, draw mode)
│   ├── SignatureTyped (text input + script font preview, type mode)
│   └── "Sign & Continue →" button (disabled until signature provided + read checkbox)
├── WizardAcknowledgeArea (for non-signature submission forms)
│   ├── "I have read this document" checkbox
│   └── "Continue →" button
├── WizardReadOnlyArea (for informational forms — no submission/signature)
│   └── "Continue →" button
└── WizardCompletion
    ├── Confetti/celebration moment
    ├── XP award display (+75 XP)
    ├── Summary grid of all signed documents
    └── "Go to Dashboard →" button
```

### Step Classification

Each orientation form is classified into one of three step types based on existing metadata:

| Condition | Step Type | UI |
|-----------|-----------|-----|
| `requiresSignature === true` | Sign | PDF + read checkbox + draw/type signature + "Sign & Continue" |
| `acceptsSubmission === true && !requiresSignature` | Acknowledge | PDF + read checkbox + "Continue" |
| `!acceptsSubmission && !requiresSignature` | Read-only | PDF + "Continue" |

Forms with `storageKey === null` (no PDF connected) show a message: "This form is not yet available digitally. Your instructor will provide a paper copy." with a "Skip & Continue" button.

### Step Order

Steps follow the `sortOrder` from `FORMS` metadata, filtered to forms that appear in orientation checklist step mappings (via `getOrientationStepDetail()`).

---

## Storage Fallback Fix

### Problem

`downloadFile()` in `src/lib/storage.ts` checks:
1. `./uploads/{storageKey}` (local dev) — directory doesn't exist
2. `./docs-upload/{storageKey}` (bundled fallback) — directory doesn't exist
3. Supabase S3 (production) — may or may not have files

The actual PDFs live in `content/04-student-onboarding/current-forms/` but the storage system doesn't look there.

### Fix

Add a third fallback in `downloadBundledFile()` that searches the `content/` directory tree by matching the filename portion of the `storageKey`. The lookup order becomes:

1. Local disk (`./uploads/`) — for student-uploaded files in dev
2. Bundled files (`./docs-upload/`) — for pre-packaged files
3. **Content directory (`./content/`)** — searches recursively by filename match
4. Supabase S3 — production storage

This is a server-side-only change. No new dependencies. The content directory is already in the repo.

### Filename Matching

Extract the filename from the storageKey (e.g., `SPOKES_Student_Profile_FY26_Fillable.pdf` from `orientation/SPOKES_Student_Profile_FY26_Fillable.pdf`) and search `content/` recursively for an exact filename match, excluding `_archive/` directories.

---

## SignaturePad Rewrite

### Current Bug

Canvas hardcoded to 500px width. Parent has `overflow-hidden`. On containers narrower than 500px, the canvas is visually clipped — drawing extends into invisible space.

### New Implementation

```
SignaturePad (rewritten)
├── Mode: "draw" | "type" (tab toggle)
├── Draw mode:
│   ├── ResizeObserver measures container width
│   ├── Canvas buffer = container width × devicePixelRatio
│   ├── Canvas CSS width = 100% of container
│   ├── Height = 150px (fixed, sufficient for signatures)
│   ├── touch-action: none in CSS
│   ├── Coordinates: clientX/clientY - getBoundingClientRect()
│   └── Clear button resets canvas
├── Type mode:
│   ├── Text input for full name
│   ├── Preview rendered in script/cursive font
│   ├── Generates canvas image from typed text for storage
│   └── Same data format as draw mode (PNG data URL)
└── Output: PNG data URL (same as current — no API changes needed)
```

The signature pad always fills its container width. No fixed pixel dimensions in props.

---

## Completion & Nav Archival

### Flow

1. Student signs/acknowledges last document
2. Wizard calls `POST /api/orientation/complete` (existing — awards 75 XP)
3. API also sets a flag on the student record (e.g., `orientationCompletedAt` timestamp)
4. Wizard shows celebration screen with summary
5. Student clicks "Go to Dashboard →"
6. Dashboard loads → `nav-items.ts` checks `orientationCompletedAt` → hides orientation tab

### Nav Restoration

If a teacher later rejects a form submission, the student's `orientationCompletedAt` is cleared and the orientation tab reappears. The wizard resumes at the rejected document.

### Teacher Side

No changes to teacher-facing components. Teachers continue to:
- View student orientation progress from StudentDetail
- Review/approve/reject form submissions
- Mark checklist items complete on behalf of students

---

## Pages & Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/orientation` (student) | `OrientationWizard` | **Replaces** current OrientationChecklist + ResourceLibrary page |
| `/teacher/orientation` | No changes | Teacher workspace unchanged |

The current `OrientationChecklist` and `ResourceLibrary` components on the student orientation page are fully replaced by the wizard. The components themselves are not deleted — they're still used on the teacher side.

---

## Data Flow

```
Mount:
  GET /api/orientation → checklist items
  GET /api/forms/status → existing submission statuses
  Derive wizard steps from items + form mappings

Per step (signature form):
  iframe loads /api/forms/download?formId={id}&mode=view
  Student checks "I have read this document"
  Student draws or types signature
  POST /api/forms/sign { formId, signature (dataUrl), studentId? }
  POST /api/orientation { itemId, completed: true }
  Advance to next step

Per step (acknowledge form):
  iframe loads PDF
  Student checks "I have read this document"
  POST /api/orientation { itemId, completed: true }
  Advance to next step

Per step (read-only form):
  iframe loads PDF
  POST /api/orientation { itemId, completed: true }
  Advance to next step

Completion:
  POST /api/orientation/complete → 75 XP + orientationCompletedAt
  Show celebration screen
  "Go to Dashboard" → router.push('/dashboard')
```

---

## Existing Code Impact

| File | Change |
|------|--------|
| `src/lib/storage.ts` | Add content directory fallback in `downloadBundledFile()` |
| `src/components/ui/SignaturePad.tsx` | Rewrite: responsive canvas + type mode |
| `src/app/(student)/orientation/page.tsx` | Replace contents with `OrientationWizard` |
| `src/lib/nav-items.ts` | Check `orientationCompletedAt` to hide orientation tab |
| `src/app/api/orientation/complete/route.ts` | Set `orientationCompletedAt` on student record |
| `prisma/schema.prisma` | Add `orientationCompletedAt DateTime?` to Student model |

### New Files

| File | Purpose |
|------|---------|
| `src/components/orientation/OrientationWizard.tsx` | Main wizard container + state machine |
| `src/components/orientation/WizardStepIndicator.tsx` | Horizontal step dots |
| `src/components/orientation/WizardCompletion.tsx` | Celebration screen |

### Unchanged

| File | Reason |
|------|--------|
| `src/components/orientation/OrientationChecklist.tsx` | Still used by teacher workspace |
| `src/components/orientation/OrientationFormDetail.tsx` | Still used by teacher workspace |
| `src/components/resources/ResourceLibrary.tsx` | Still used elsewhere |
| `src/components/resources/ResourceCard.tsx` | Still used elsewhere |
| All `/api/forms/*` routes | No API changes needed |
| `src/lib/spokes/forms.ts` | Form metadata unchanged |
| `src/lib/orientation-step-resources.ts` | Step-to-form mapping unchanged |

---

## Non-Goals

- No changes to teacher-facing orientation workflow
- No PDF-to-HTML conversion (using native browser PDF viewer)
- No new npm dependencies
- No changes to form metadata or step mappings
- No mobile-specific optimizations (desktop is primary device)
