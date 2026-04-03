# Orientation Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clunky orientation checklist with a full-page stepper wizard that fixes broken PDF links, fixes the signature canvas clipping bug, and auto-archives the orientation tab on completion.

**Architecture:** Storage fallback fix → responsive SignaturePad rewrite with draw/type modes → wizard stepper component → student orientation page swap → nav archival. Each task builds on the last. No new npm dependencies. No schema migrations (orientationComplete already exists in ProgressionState JSON).

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS 4, HTML5 Canvas, iframe PDF viewer, existing Prisma models

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/storage.ts` | Modify | Add content directory fallback for PDF serving |
| `src/components/ui/SignaturePad.tsx` | Rewrite | Responsive canvas + type-to-sign mode |
| `src/components/orientation/WizardStepIndicator.tsx` | Create | Horizontal step dots + document title |
| `src/components/orientation/WizardCompletion.tsx` | Create | Celebration screen with summary |
| `src/components/orientation/OrientationWizard.tsx` | Create | Main wizard container + state machine |
| `src/app/(student)/orientation/page.tsx` | Modify | Swap to OrientationWizard |
| `src/lib/nav-items.ts` | Modify | Filter orientation when complete |
| `src/app/(student)/layout.tsx` | Modify | Pass orientationComplete to NavBar |
| `src/components/ui/NavBar.tsx` | Modify | Accept + use orientationComplete prop |

---

### Task 1: Storage Fallback Fix

**Files:**
- Modify: `src/lib/storage.ts:96-109` (downloadBundledFile function)

The download API returns 404 for all PDFs because it searches `docs-upload/` (doesn't exist) and `uploads/` (doesn't exist). The actual PDFs are in `content/`. Add a filename-based fallback that searches the content directory.

- [ ] **Step 1: Add content directory search function to storage.ts**

Add this function after the existing `downloadBundledFile` function (after line 109) in `src/lib/storage.ts`:

```typescript
const CONTENT_DIR = path.join(process.cwd(), "content");

async function findInContentDir(
  storageKey: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const targetName = path.basename(storageKey);
  if (!targetName || targetName.includes("..")) return null;

  async function search(dir: string): Promise<string | null> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "_archive") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await search(full);
        if (found) return found;
      } else if (entry.name === targetName) {
        return full;
      }
    }
    return null;
  }

  const found = await search(CONTENT_DIR);
  if (!found) return null;
  try {
    const buffer = await fs.readFile(found);
    return { buffer, mimeType: inferMimeType(found) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Wire content fallback into downloadBundledFile**

Replace the existing `downloadBundledFile` function (lines 96-109) with:

```typescript
export async function downloadBundledFile(
  storageKey: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const resolved = resolveStoragePath(BUNDLED_UPLOAD_DIR, storageKey);
    const buffer = await fs.readFile(resolved);
    return {
      buffer,
      mimeType: inferMimeType(storageKey),
    };
  } catch {
    // Fallback: search content directory by filename
    return findInContentDir(storageKey);
  }
}
```

- [ ] **Step 3: Verify the fix locally**

Run the dev server and test:
```bash
cd /Users/brittlegg/visionquest && npm run dev
```

Open `http://localhost:3000/api/forms/download?formId=student-profile&mode=view` in a browser. It should return the PDF instead of a 404 JSON error.

- [ ] **Step 4: Commit**

```bash
git add src/lib/storage.ts
git commit -m "fix: add content directory fallback for orientation PDF serving"
```

---

### Task 2: Responsive SignaturePad with Draw/Type Modes

**Files:**
- Rewrite: `src/components/ui/SignaturePad.tsx`

The current canvas is hardcoded to 500px width, clipping signatures on narrower containers. Rewrite with ResizeObserver for responsive sizing and add a "type your name" alternative.

- [ ] **Step 1: Rewrite SignaturePad.tsx**

Replace the entire contents of `src/components/ui/SignaturePad.tsx` with:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SignatureMode = "draw" | "type";

interface SignaturePadProps {
  onSign: (dataUrl: string) => void;
  onCancel: () => void;
}

const CANVAS_HEIGHT = 150;
const STROKE_COLOR = "#1a2a3a";
const STROKE_WIDTH = 2;

export default function SignaturePad({ onSign, onCancel }: SignaturePadProps) {
  const [mode, setMode] = useState<SignatureMode>("draw");
  const [typedName, setTypedName] = useState("");

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex overflow-hidden rounded-lg border border-[rgba(18,38,63,0.12)]">
        <button
          type="button"
          onClick={() => setMode("draw")}
          className={`flex-1 px-4 py-2 text-xs font-semibold transition-colors ${
            mode === "draw"
              ? "bg-[var(--ink-strong)] text-white"
              : "bg-[rgba(16,37,62,0.03)] text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.06)]"
          }`}
        >
          Draw
        </button>
        <button
          type="button"
          onClick={() => setMode("type")}
          className={`flex-1 px-4 py-2 text-xs font-semibold transition-colors ${
            mode === "type"
              ? "bg-[var(--ink-strong)] text-white"
              : "bg-[rgba(16,37,62,0.03)] text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.06)]"
          }`}
        >
          Type
        </button>
      </div>

      {mode === "draw" ? (
        <DrawPad onSign={onSign} onCancel={onCancel} />
      ) : (
        <TypePad
          typedName={typedName}
          onTypedNameChange={setTypedName}
          onSign={onSign}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Draw Mode                                                                 */
/* -------------------------------------------------------------------------- */

function DrawPad({
  onSign,
  onCancel,
}: {
  onSign: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const containerWidthRef = useRef(0);

  // Responsive canvas sizing via ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    function resize() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const width = container.clientWidth;
      containerWidthRef.current = width;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = CANVAS_HEIGHT * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = STROKE_WIDTH;
      ctx.strokeStyle = STROKE_COLOR;
      setHasStrokes(false);
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const getPoint = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [],
  );

  const startStroke = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const point = getPoint(e);
      if (!point) return;
      setIsDrawing(true);
      lastPointRef.current = point;
    },
    [getPoint],
  );

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing) return;
      e.preventDefault();
      const point = getPoint(e);
      if (!point) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && lastPointRef.current) {
        ctx.beginPath();
        ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        lastPointRef.current = point;
        setHasStrokes(true);
      }
    },
    [isDrawing, getPoint],
  );

  const endStroke = useCallback(() => {
    setIsDrawing(false);
    lastPointRef.current = null;
  }, []);

  function clearPad() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Re-apply scale after clearing
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = STROKE_WIDTH;
    ctx.strokeStyle = STROKE_COLOR;
    setHasStrokes(false);
  }

  function handleSubmit() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    const width = containerWidthRef.current;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = width;
    exportCanvas.height = CANVAS_HEIGHT;
    const exportCtx = exportCanvas.getContext("2d");
    if (!exportCtx) return;
    exportCtx.drawImage(canvas, 0, 0, width, CANVAS_HEIGHT);
    onSign(exportCanvas.toDataURL("image/png"));
  }

  return (
    <>
      <div ref={containerRef} className="relative overflow-hidden rounded-xl border-2 border-dashed border-[rgba(18,38,63,0.2)] bg-white">
        <canvas
          ref={canvasRef}
          className="block cursor-crosshair touch-none"
          onMouseDown={startStroke}
          onMouseMove={draw}
          onMouseUp={endStroke}
          onMouseLeave={endStroke}
          onTouchStart={startStroke}
          onTouchMove={draw}
          onTouchEnd={endStroke}
        />
        <div className="pointer-events-none absolute left-6 right-6" style={{ bottom: "24px" }}>
          <div className="border-b border-gray-300" />
          <p className="mt-1 text-center text-[10px] text-gray-400">Sign above this line</p>
        </div>
        {!hasStrokes && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-gray-300">Draw your signature here</p>
          </div>
        )}
      </div>
      <SignatureButtons
        onClear={clearPad}
        onCancel={onCancel}
        onSubmit={handleSubmit}
        canClear={hasStrokes}
        canSubmit={hasStrokes}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Type Mode                                                                 */
/* -------------------------------------------------------------------------- */

function TypePad({
  typedName,
  onTypedNameChange,
  onSign,
  onCancel,
}: {
  typedName: string;
  onTypedNameChange: (name: string) => void;
  onSign: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trimmed = typedName.trim();

  function handleSubmit() {
    if (!trimmed) return;
    // Render typed name to canvas as PNG data URL
    const width = containerRef.current?.clientWidth || 500;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, CANVAS_HEIGHT);
    // Signature line
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, CANVAS_HEIGHT - 30);
    ctx.lineTo(width - 24, CANVAS_HEIGHT - 30);
    ctx.stroke();
    // Typed name in cursive
    ctx.fillStyle = STROKE_COLOR;
    ctx.font = "italic 32px 'Georgia', 'Times New Roman', serif";
    ctx.textBaseline = "bottom";
    ctx.fillText(trimmed, 32, CANVAS_HEIGHT - 36);
    onSign(canvas.toDataURL("image/png"));
  }

  return (
    <>
      <div ref={containerRef} className="space-y-3">
        <div className="rounded-xl border-2 border-dashed border-[rgba(18,38,63,0.2)] bg-white p-4">
          <label className="block text-xs font-semibold text-[var(--ink-muted)] mb-2">
            Type your full name
          </label>
          <input
            type="text"
            value={typedName}
            onChange={(e) => onTypedNameChange(e.target.value)}
            placeholder="Your full legal name"
            className="w-full border-b-2 border-gray-300 bg-transparent pb-1 text-lg text-[var(--ink-strong)] placeholder:text-gray-300 outline-none focus:border-[var(--accent-secondary)]"
            autoComplete="name"
          />
          {trimmed && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-[10px] text-gray-400 mb-1">Preview</p>
              <p className="font-serif text-2xl italic text-[#1a2a3a]">{trimmed}</p>
            </div>
          )}
        </div>
      </div>
      <SignatureButtons
        onClear={() => onTypedNameChange("")}
        onCancel={onCancel}
        onSubmit={handleSubmit}
        canClear={!!trimmed}
        canSubmit={!!trimmed}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shared Buttons                                                            */
/* -------------------------------------------------------------------------- */

function SignatureButtons({
  onClear,
  onCancel,
  onSubmit,
  canClear,
  canSubmit,
}: {
  onClear: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  canClear: boolean;
  canSubmit: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onClear}
        disabled={!canClear}
        className="rounded-lg border border-[rgba(18,38,63,0.12)] px-4 py-2 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)] disabled:opacity-40"
      >
        Clear
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[rgba(18,38,63,0.12)] px-4 py-2 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-strong)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="primary-button px-5 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sign & Submit
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify SignaturePad renders correctly**

Run the dev server. Navigate to the orientation page and expand a form that requires signature. The draw/type toggle should appear and the canvas should fill its container width.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/SignaturePad.tsx
git commit -m "fix: rewrite SignaturePad with responsive canvas and type-to-sign mode"
```

---

### Task 3: WizardStepIndicator Component

**Files:**
- Create: `src/components/orientation/WizardStepIndicator.tsx`

Horizontal step dots showing progress through the wizard. Shows completed steps as green checks, current step highlighted, future steps as gray dots.

- [ ] **Step 1: Create WizardStepIndicator.tsx**

```typescript
"use client";

interface WizardStepIndicatorProps {
  totalSteps: number;
  currentStep: number;  // 0-indexed
  currentTitle: string;
}

export default function WizardStepIndicator({
  totalSteps,
  currentStep,
  currentTitle,
}: WizardStepIndicatorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalSteps }, (_, i) => {
          const isComplete = i < currentStep;
          const isCurrent = i === currentStep;
          return (
            <div key={i} className="flex items-center gap-1.5">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  isComplete
                    ? "bg-emerald-500 text-white"
                    : isCurrent
                      ? "bg-[var(--ink-strong)] text-white"
                      : "bg-gray-200 text-gray-400"
                }`}
              >
                {isComplete ? "✓" : i + 1}
              </div>
              {i < totalSteps - 1 && (
                <div
                  className={`h-0.5 w-4 rounded-full transition-colors sm:w-6 ${
                    isComplete ? "bg-emerald-500" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-[var(--ink-muted)]">
        Document {currentStep + 1} of {totalSteps} — <span className="font-semibold text-[var(--ink-strong)]">{currentTitle}</span>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/orientation/WizardStepIndicator.tsx
git commit -m "feat: add WizardStepIndicator component"
```

---

### Task 4: WizardCompletion Component

**Files:**
- Create: `src/components/orientation/WizardCompletion.tsx`

Celebration screen shown after all documents are signed. Shows XP award, summary grid of signed documents, and "Go to Dashboard" button.

- [ ] **Step 1: Create WizardCompletion.tsx**

```typescript
"use client";

import { useRouter } from "next/navigation";

interface CompletedForm {
  title: string;
  type: "signed" | "acknowledged" | "read";
}

interface WizardCompletionProps {
  completedForms: CompletedForm[];
}

export default function WizardCompletion({ completedForms }: WizardCompletionProps) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-xl text-center">
      <div className="text-5xl mb-4">🎉</div>
      <h2 className="font-display text-2xl font-bold text-emerald-700">
        Orientation Complete!
      </h2>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        You signed all your documents and earned{" "}
        <span className="font-bold text-amber-500">75 XP</span>
      </p>

      <div className="mt-6 rounded-2xl border border-[rgba(16,37,62,0.08)] bg-[rgba(16,37,62,0.02)] p-5 text-left">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--ink-muted)] mb-3">
          Documents Completed
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {completedForms.map((form) => (
            <div key={form.title} className="flex items-center gap-2 text-sm text-emerald-700">
              <span className="text-emerald-500">✓</span>
              <span className="truncate">{form.title}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        This page will be removed from your menu.
      </p>

      <button
        type="button"
        onClick={() => router.push("/dashboard")}
        className="primary-button mt-6 px-8 py-3 text-sm"
      >
        Go to Dashboard →
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/orientation/WizardCompletion.tsx
git commit -m "feat: add WizardCompletion celebration screen"
```

---

### Task 5: OrientationWizard Main Component

**Files:**
- Create: `src/components/orientation/OrientationWizard.tsx`

Main wizard container. Loads orientation items and form metadata, derives wizard steps, manages step navigation, handles signing and acknowledgment submissions.

- [ ] **Step 1: Create OrientationWizard.tsx**

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { useProgression } from "@/components/progression/ProgressionProvider";
import { getOrientationStepDetail } from "@/lib/orientation-step-resources";
import {
  buildFormDownloadUrl,
  hasDownloadableFormDocument,
  type SpokesForm,
} from "@/lib/spokes/forms";
import SignaturePad from "@/components/ui/SignaturePad";
import WizardStepIndicator from "./WizardStepIndicator";
import WizardCompletion from "./WizardCompletion";

interface OrientationItem {
  id: string;
  label: string;
  description: string | null;
  section: string | null;
  required: boolean;
  completed: boolean;
}

type StepType = "sign" | "acknowledge" | "read-only" | "no-pdf";

interface WizardStep {
  orientationItemId: string;
  form: SpokesForm;
  type: StepType;
}

function classifyStep(form: SpokesForm): StepType {
  if (!hasDownloadableFormDocument(form)) return "no-pdf";
  if (form.requiresSignature) return "sign";
  if (form.acceptsSubmission) return "acknowledge";
  return "read-only";
}

function deriveSteps(items: OrientationItem[]): WizardStep[] {
  const steps: WizardStep[] = [];
  for (const item of items) {
    if (item.completed) continue;
    const detail = getOrientationStepDetail(item.label);
    for (const form of detail.forms) {
      steps.push({
        orientationItemId: item.id,
        form,
        type: classifyStep(form),
      });
    }
    // Items with no forms still need acknowledgment
    if (detail.forms.length === 0) {
      continue; // Skip items without forms — they're non-document steps
    }
  }
  return steps;
}

interface CompletedForm {
  title: string;
  type: "signed" | "acknowledged" | "read";
}

export default function OrientationWizard() {
  const { checkProgression } = useProgression();
  const [items, setItems] = useState<OrientationItem[]>([]);
  const [steps, setSteps] = useState<WizardStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasRead, setHasRead] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completedForms, setCompletedForms] = useState<CompletedForm[]>([]);
  const [allAlreadyDone, setAllAlreadyDone] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/orientation");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      const fetchedItems: OrientationItem[] = data.items || [];
      setItems(fetchedItems);

      const derivedSteps = deriveSteps(fetchedItems);
      if (derivedSteps.length === 0) {
        // All items already completed
        setAllAlreadyDone(true);
      }
      setSteps(derivedSteps);
    } catch {
      setError("Failed to load orientation. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function markItemComplete(itemId: string) {
    await fetch("/api/orientation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, completed: true }),
    });
  }

  async function handleSign(dataUrl: string) {
    const step = steps[currentStep];
    if (!step) return;
    setSubmitting(true);
    setError(null);
    try {
      const signRes = await fetch("/api/forms/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId: step.form.id, signature: dataUrl }),
      });
      if (!signRes.ok) {
        const data = await signRes.json().catch(() => ({}));
        setError(data.error || "Signature submission failed.");
        return;
      }
      await markItemComplete(step.orientationItemId);
      advanceStep({ title: step.form.title, type: "signed" });
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAcknowledge() {
    const step = steps[currentStep];
    if (!step) return;
    setSubmitting(true);
    setError(null);
    try {
      await markItemComplete(step.orientationItemId);
      const type = step.type === "acknowledge" ? "acknowledged" : "read";
      advanceStep({ title: step.form.title, type });
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkipNoPdf() {
    const step = steps[currentStep];
    if (!step) return;
    setSubmitting(true);
    try {
      await markItemComplete(step.orientationItemId);
      advanceStep({ title: step.form.title, type: "read" });
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function advanceStep(completedForm: CompletedForm) {
    const newCompleted = [...completedForms, completedForm];
    setCompletedForms(newCompleted);
    setHasRead(false);
    setShowSignature(false);
    setError(null);

    if (currentStep + 1 >= steps.length) {
      // All done — fire completion
      completeOrientation(newCompleted);
    } else {
      setCurrentStep(currentStep + 1);
    }
  }

  async function completeOrientation(forms: CompletedForm[]) {
    try {
      await fetch("/api/orientation/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setTimeout(() => checkProgression(), 500);
    } catch {
      // Non-critical — XP may not display but completion is saved
    }
    setCompletedForms(forms);
    setCompleted(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-gray-400">Loading orientation...</p>
      </div>
    );
  }

  if (error && steps.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          type="button"
          onClick={() => { setError(null); setLoading(true); void fetchData(); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (allAlreadyDone) {
    return (
      <WizardCompletion
        completedForms={items
          .filter((i) => i.completed)
          .map((i) => ({ title: i.label, type: "read" as const }))}
      />
    );
  }

  if (completed) {
    return <WizardCompletion completedForms={completedForms} />;
  }

  const step = steps[currentStep];
  if (!step) return null;

  const pdfUrl = hasDownloadableFormDocument(step.form)
    ? buildFormDownloadUrl(step.form, "view")
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <WizardStepIndicator
        totalSteps={steps.length}
        currentStep={currentStep}
        currentTitle={step.form.title}
      />

      {/* PDF Viewer */}
      {step.type === "no-pdf" ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[rgba(16,37,62,0.08)] bg-[rgba(16,37,62,0.02)] py-16">
          <p className="text-sm text-[var(--ink-muted)]">
            This form is not yet available digitally.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Your instructor will provide a paper copy.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[rgba(16,37,62,0.08)]">
          <iframe
            key={step.form.id}
            src={pdfUrl!}
            title={step.form.title}
            className="h-[500px] w-full border-0 bg-white"
          />
        </div>
      )}

      {/* Action area */}
      <div className="rounded-2xl border border-[rgba(16,37,62,0.08)] bg-[rgba(16,37,62,0.02)] p-5 space-y-4">
        {/* Read checkbox (for sign and acknowledge types) */}
        {(step.type === "sign" || step.type === "acknowledge") && (
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={hasRead}
              onChange={(e) => setHasRead(e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm text-[var(--ink-strong)]">
              I have read this document
            </span>
          </label>
        )}

        {/* Signature area (sign type only) */}
        {step.type === "sign" && hasRead && (
          showSignature ? (
            <div>
              {submitting && (
                <p className="mb-2 text-xs text-[var(--ink-muted)]">Submitting...</p>
              )}
              <SignaturePad
                onSign={handleSign}
                onCancel={() => setShowSignature(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSignature(true)}
              className="primary-button px-6 py-2.5 text-sm"
            >
              Sign & Continue →
            </button>
          )
        )}

        {/* Continue button (acknowledge type) */}
        {step.type === "acknowledge" && (
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={!hasRead || submitting}
            className="primary-button px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Continue →"}
          </button>
        )}

        {/* Continue button (read-only type) */}
        {step.type === "read-only" && (
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={submitting}
            className="primary-button px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Continue →"}
          </button>
        )}

        {/* Skip button (no-pdf type) */}
        {step.type === "no-pdf" && (
          <button
            type="button"
            onClick={handleSkipNoPdf}
            disabled={submitting}
            className="primary-button px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Skip & Continue →"}
          </button>
        )}

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/orientation/OrientationWizard.tsx
git commit -m "feat: add OrientationWizard stepper component"
```

---

### Task 6: Wire Up Student Orientation Page

**Files:**
- Modify: `src/app/(student)/orientation/page.tsx`

Replace the current OrientationChecklist + ResourceLibrary with the new wizard.

- [ ] **Step 1: Replace orientation page contents**

Replace the entire contents of `src/app/(student)/orientation/page.tsx` with:

```typescript
import OrientationWizard from "@/components/orientation/OrientationWizard";
import PageIntro from "@/components/ui/PageIntro";

export default function OrientationPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Get started"
        title="Orientation"
        description="Read and sign each document to complete your SPOKES orientation."
      />
      <div className="surface-section p-5">
        <OrientationWizard />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the wizard renders**

Run the dev server. Navigate to `/orientation` as a student. The wizard should load steps and display the first document in an iframe.

- [ ] **Step 3: Commit**

```bash
git add src/app/(student)/orientation/page.tsx
git commit -m "feat: replace orientation page with wizard stepper"
```

---

### Task 7: Nav Archival — Hide Orientation When Complete

**Files:**
- Modify: `src/lib/nav-items.ts`
- Modify: `src/app/(student)/layout.tsx`
- Modify: `src/components/ui/NavBar.tsx`

When `orientationComplete` is true in the student's progression state, filter the Orientation item out of the nav. The layout already reads `progState.orientationComplete` — we just need to pass it through.

- [ ] **Step 1: Add orientationComplete parameter to nav filter functions**

In `src/lib/nav-items.ts`, modify the two filter functions to accept an optional `orientationComplete` flag:

```typescript
export function getVisibleNavItems(phase: NavPhase, orientationComplete?: boolean): NavItem[] {
  return STUDENT_NAV_ITEMS.filter((item) => {
    if (item.phase > phase) return false;
    if (orientationComplete && item.href === "/orientation") return false;
    return true;
  });
}

export function getVisibleSecondaryNavItems(phase: NavPhase): NavItem[] {
  return STUDENT_SECONDARY_NAV.filter((item) => item.phase <= phase);
}
```

- [ ] **Step 2: Pass orientationComplete from layout to NavBar**

In `src/app/(student)/layout.tsx`, add `orientationComplete` to the NavBar props. Replace line 45:

```typescript
<NavBar studentName={session.displayName} role={session.role} navPhase={navPhase} orientationComplete={progState.orientationComplete || false} />
```

- [ ] **Step 3: Update NavBar to accept and use orientationComplete**

In `src/components/ui/NavBar.tsx`, add `orientationComplete` to the `NavBarProps` interface (line 34-38):

```typescript
interface NavBarProps {
  studentName: string;
  role: string;
  navPhase?: NavPhase;
  orientationComplete?: boolean;
}
```

Update the NavBar function signature (line 40):

```typescript
export default function NavBar({ studentName, role, navPhase, orientationComplete }: NavBarProps) {
```

Update the primary items computation (line 69-74) to pass `orientationComplete`:

```typescript
  const primaryItems =
    role === "student"
      ? getVisibleNavItems(navPhase ?? 3, orientationComplete)
      : role === "admin"
        ? [...ADMIN_ITEMS, ...STAFF_ITEMS]
        : STAFF_ITEMS;
```

Update the allStudentItems computation (line 82) to pass `orientationComplete`:

```typescript
  const allStudentItems = [...getVisibleNavItems(navPhase ?? 3, orientationComplete), ...getVisibleSecondaryNavItems(navPhase ?? 3)];
```

- [ ] **Step 4: Verify nav archival**

With a student account that has `orientationComplete: true` in their progression state, verify the Orientation tab no longer appears in the sidebar or mobile nav.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nav-items.ts src/app/(student)/layout.tsx src/components/ui/NavBar.tsx
git commit -m "feat: hide orientation nav tab after completion"
```

---

### Task 8: Build Verification

**Files:** None — verification only.

- [ ] **Step 1: Run TypeScript type check**

```bash
cd /Users/brittlegg/visionquest && npx tsc --noEmit
```

Fix any type errors that surface.

- [ ] **Step 2: Run the build**

```bash
npm run build
```

Fix any build errors.

- [ ] **Step 3: Manual smoke test**

With the dev server running:
1. Log in as a student with incomplete orientation
2. Navigate to `/orientation` — wizard should show with step indicator
3. First document should load in iframe
4. Check "I have read this document" → signature button appears
5. Toggle between Draw/Type signature modes
6. Sign and submit → advances to next document
7. Complete all documents → celebration screen appears
8. Click "Go to Dashboard" → orientation tab should be gone from nav

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address build and type errors from orientation wizard"
```
