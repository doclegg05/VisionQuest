# OKF Org-Knowledge Catalog — Implementation Plan (Phase 0 + Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an eval baseline for both retrieval pipelines, then build an OKF markdown catalog for the ambiguous student-facing forms/docs whose curated routing notes sync into the runtime so Sage stops retrieving the wrong one — with the improvement proven against the baseline.

**Architecture:** A git-tracked, flat `catalog/` of OKF markdown nodes is the *curated source* of soft routing metadata. Pure TypeScript logic lives in `src/lib/catalog/` (unit-tested); thin `.mjs` CLIs in `scripts/catalog/` do the IO. Hard identity is derived from `forms.ts` + `ProgramDocument`; soft routing (when-to-use notes, tags) is agent-drafted + human-approved, then synced into the DB-backed stores the runtime already reads (`ProgramDocument.sageContextNote` re-embedded; a generated `config/form-routing.generated.json` overlay consumed by `form-search.ts`).

**Tech Stack:** TypeScript (strict), Node.js `node:test` via `tsx`, Prisma 6, pgvector, `gray-matter` (new — frontmatter parsing), `zod` (existing — config validation), `node-cache` (existing — cache invalidation).

## Global Constraints

- **TDD always:** failing test → run-fail → minimal impl → run-pass → commit. One logical change per commit; conventional commit messages (`feat`/`test`/`fix`/`chore`/`docs`).
- **No PII / FERPA:** catalog covers organizational knowledge only. The generator reads ONLY `forms.ts` + `ProgramDocument` + the allowlist — NEVER `FileUpload` or student data. Drafted notes MUST NOT copy filled-form examples, names, or any per-person text from source docs. Scanned-image documents (`.jpg`/`.png`) are excluded from auto-drafting.
- **Anti-drift field ownership:** hard identity (`type, title, resource, vq_id, vq_audience, vq_category, vq_certification, vq_platform, vq_storage_key`) is generator-derived from source and validator-enforced; soft routing (`description, tags`, body sections) is catalog-owned. No field authored in two places.
- **Reviewable artifact before mutation:** nodes carry `vq_status: draft|approved`. Sync touches the DB ONLY for `approved` nodes, and only after a printed dry-run manifest. Sync is the single writer for catalogued notes.
- **Re-embed is mandatory:** any change to a document's `sageContextNote` MUST re-embed via `embedProgramDocument()` (preserving chunks) and then `invalidatePrefix("sage:documents")`. The doc-level vector embeds `title + sageContextNote` (`src/lib/sage/document-embedding.ts:46`); a text-only write leaves the semantic half stale.
- **File depth ≤ 3 levels** from repo root (user-global rule): `catalog/` is flat; the graph is markdown links, not folders.
- **No new `ProgramDocument` columns** in this phase. Only `sageContextNote` (re-embedded) moves document ranking; `tags`/`description` serve navigation + the form overlay.
- **Tests live under `src/`** and run with `npx tsx --test src/lib/catalog/<file>.test.ts` (the `npm test` glob only sees git-tracked `src/*.test.ts`, so run new files directly until committed).
- **Audience mapping:** `SpokesForm.audience` is lowercase (`student|instructor|both`); catalog `vq_audience` is uppercase (`STUDENT|TEACHER|BOTH`). Map: `student→STUDENT`, `instructor→TEACHER`, `both→BOTH`.

---

## File Structure

**Phase 0 (eval):**
- Create: `config/sage-rag-eval.json` — extended document-RAG fixture (confusion/no-answer/paraphrase/audience cases).
- Create: `config/sage-form-eval.json` — form-ranking fixture (expected `form.id`).
- Create: `scripts/sage-form-harness.mjs` — form-ranking harness (mirrors `sage-rag-harness.mjs`).
- Modify: `scripts/sage-rag-harness.mjs` — add audience-leakage metric.
- Modify: `package.json` — add `sage:form:harness` script.

**Phase 1 (catalog):**
- Create: `src/lib/catalog/schema.ts` — shared types (no IO).
- Create: `src/lib/catalog/parse.ts` (+ `parse.test.ts`) — markdown node → typed node.
- Create: `src/lib/catalog/generate.ts` (+ `generate.test.ts`) — source → skeleton node markdown (pure).
- Create: `src/lib/catalog/validate.ts` (+ `validate.test.ts`) — frontmatter/drift/links/parity/FERPA rules (pure).
- Create: `src/lib/catalog/sync.ts` (+ `sync.test.ts`) — manifest + overlay builders (pure) + thin apply helpers.
- Create: `src/lib/catalog/drift-audit.ts` (+ `drift-audit.test.ts`) — DB-note vs approved-node compare (pure).
- Create: `scripts/catalog/generate.mjs`, `validate.mjs`, `sync.mjs`, `drift.mjs` — CLIs.
- Create: `config/catalog-allowlist.json` — Phase-1 membership.
- Create: `config/form-routing.generated.json` — sync output (overlay).
- Create: `catalog/index.md`, `catalog/log.md`, `catalog/{forms,documents,certifications,platforms}/*.md` — the nodes.
- Modify: `src/lib/spokes/form-search.ts` (+ extend `form-search.test.ts`) — consume the overlay; reset hook.
- Modify: `package.json` — add `catalog:*` scripts.
- Modify: `scripts/prepare-standalone-assets.mjs` — ensure `config/form-routing.generated.json` ships in the standalone build.

---

# PHASE 0 — Correct the record + build the measuring stick

## Task 0.1: Extended document-RAG eval fixture + audience-leakage metric

**Files:**
- Create: `config/sage-rag-eval.json`
- Modify: `scripts/sage-rag-harness.mjs` (metrics block ~lines 195–240)

**Interfaces:**
- Consumes: `getDocumentContext(question, role, maxResults, tokenBudgetChars)` (existing), fixture item shape `{ id, question, expectedStorageKeys?, acceptableStorageKeys?, expectedTerms? }`.
- Produces: a committed baseline report; a new `audienceLeakage` count in the report object.

- [ ] **Step 0: Create the catalog log** so Phase 0 has somewhere to record baselines (the rest of `catalog/` is scaffolded in Task 1.4).

```bash
mkdir -p catalog
```

Create `catalog/log.md`:

```markdown
# Catalog Log (newest first)

## 2026-06-30 — Phase 0 baselines
- Document RAG (config/sage-rag-eval.json, student): top1=<fill>, top3=<fill>, cleanTop3=<fill>, audienceLeakage=<fill>, noAnswerPassed=<fill>
- Form ranking (config/sage-form-eval.json): top1=<fill>, top3=<fill>, cleanTop3=<fill>, forbiddenHits=<fill>
```

- [ ] **Step 1: Author the extended fixture** (`config/sage-rag-eval.json`) as a **top-level JSON array** — the harness does `JSON.parse(...).flatMap(...)` at line 107 then `for (const item of questions)` at 117, so an object like `{cases:[]}` breaks it. Item shape = the existing `{ id, question, expectedStorageKeys?, acceptableStorageKeys?, expectedTerms? }` plus two new optional fields this task adds: `forbiddenStorageKeys?` and `expectNoContext?`. Include ≥6 close-confusion cases, ≥3 no-answer cases (`expectNoContext: true`), ≥4 low-literacy paraphrases, ≥3 student-role cases with TEACHER-only `forbiddenStorageKeys`. (`role` is a per-run CLI flag, not per item.)

```json
[
  { "id": "confuse-dfa-ts12-vs-wvw70", "question": "where's the timesheet i fill out each week", "expectedStorageKeys": ["forms/DFA-TS-12.pdf"], "forbiddenStorageKeys": ["forms/DFA-WVW-70.pdf"] },
  { "id": "noanswer-medical", "question": "what dose of insulin should i take", "expectNoContext": true },
  { "id": "paraphrase-ready-to-work", "question": "the paper that says i finished and i'm ready for a job", "expectedStorageKeys": ["forms/Ready-to-Work-Certificate.pdf"] },
  { "id": "audience-leak-teacher-guide", "question": "how do i run orientation", "forbiddenStorageKeys": ["teachers/Admin-Guide.pdf"] }
]
```

- [ ] **Step 2: Add the two metrics to the harness** (`scripts/sage-rag-harness.mjs`). The harness already resolves matches to `matchedDocuments[]` with `.storageKey` (lines 130–140). Compute leakage from THOSE keys — NOT `context.includes(storageKey)`, because rendered links carry the doc `id`, not the storageKey (`formatEntry`, knowledge-base-server.ts:171). Inside the per-case loop after `hasContext` (line 165):

```javascript
const forbiddenSet = new Set(asArray(item.forbiddenStorageKeys));
const audienceLeak = matchedDocuments.filter((doc) => doc.storageKey && forbiddenSet.has(doc.storageKey)).length;
const noAnswerOk = item.expectNoContext ? !hasContext : null;
```

Add `audienceLeak` and `noAnswerOk` to the per-result `results.push({...})` object (lines 172–192). Then after the aggregates block (line ~205) add:

```javascript
const audienceLeakage = results.reduce((sum, r) => sum + (r.audienceLeak ?? 0), 0);
const noAnswerCases = results.filter((r) => r.noAnswerOk !== null);
const noAnswerPassed = noAnswerCases.filter((r) => r.noAnswerOk).length;
```

and add `audienceLeakage`, `noAnswerPassed`, and `noAnswerTotal: noAnswerCases.length` to the `report` object (lines 221–240).

- [ ] **Step 3: Run the harness against the new fixture and record the baseline.**

Run: `npm run sage:rag:harness -- --fixture=config/sage-rag-eval.json --role=student --json`
Expected: a report with `top1Expected`, `top3Expected`, `cleanTop3`, `audienceLeakage` (target 0), and `noAnswerPassed`. **Fill these numbers into `catalog/log.md`** (created in Step 0) — they are the Phase-1 gate baseline.

- [ ] **Step 4: Commit.**

```bash
git add catalog/log.md config/sage-rag-eval.json scripts/sage-rag-harness.mjs
git commit -m "test(rag): document eval fixture + audience-leakage + no-answer metrics"
```

## Task 0.2: Form-ranking eval harness + baseline

**Files:**
- Create: `config/sage-form-eval.json`
- Create: `scripts/sage-form-harness.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `searchForms({ query, role, limit })` → `FormSearchResult { candidates: { form: SpokesForm; score; available }[]; method }` from `src/lib/spokes/form-search.ts`.
- Produces: `npm run sage:form:harness`; a committed form baseline (top-1/top-3/clean-top-3 by `form.id`).

- [ ] **Step 1: Author the form fixture** (`config/sage-form-eval.json`). Mirror the doc confusion set but with expected `form.id`.

```json
{
  "cases": [
    { "id": "timesheet", "query": "weekly timesheet i turn in", "role": "student", "expectedFormIds": ["dfa-ts-12"], "forbiddenFormIds": ["dfa-wvw-70"] },
    { "id": "attendance", "query": "the paper promising i'll show up", "role": "student", "expectedFormIds": ["attendance-contract"] },
    { "id": "media-release", "query": "can they use my photo", "role": "student", "expectedFormIds": ["media-release"] }
  ]
}
```

- [ ] **Step 2: Write the harness** (`scripts/sage-form-harness.mjs`), mirroring `sage-rag-harness.mjs`'s load/loop/report shape.

```javascript
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

async function main() {
  const args = parseArgs();
  const fixturePath = args.fixture ?? "config/sage-form-eval.json";
  const { cases } = JSON.parse(readFileSync(fixturePath, "utf8"));
  const { searchForms } = await import("../src/lib/spokes/form-search.ts");

  let top1 = 0, top3 = 0, cleanTop3 = 0, forbiddenHits = 0;
  const results = [];
  for (const c of cases) {
    const { candidates } = await searchForms({ query: c.query, role: c.role, limit: 3 });
    const ids = candidates.map((x) => x.form.id);
    const expected = c.expectedFormIds ?? [];
    const forbidden = c.forbiddenFormIds ?? [];
    const inTop1 = expected.length > 0 && ids[0] === expected[0];
    const inTop3 = expected.some((e) => ids.includes(e));
    const clean = inTop3 && !ids.slice(0, 3).some((id) => forbidden.includes(id));
    if (inTop1) top1++;
    if (inTop3) top3++;
    if (clean) cleanTop3++;
    forbiddenHits += ids.slice(0, 3).filter((id) => forbidden.includes(id)).length;
    results.push({ id: c.id, ids, inTop1, inTop3, clean });
  }
  const report = { fixturePath, total: cases.length, top1, top3, cleanTop3, forbiddenHits, results };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Add the npm script.** In `package.json` scripts, after `"sage:rag:harness"`:

```json
"sage:form:harness": "tsx scripts/sage-form-harness.mjs",
```

- [ ] **Step 4: Run it and record the baseline.**

Run: `npm run sage:form:harness`
Expected: JSON with `top1`, `top3`, `cleanTop3`, `forbiddenHits`. **Record in `catalog/log.md`** (Task 1.4).

- [ ] **Step 5: Commit.**

```bash
git add config/sage-form-eval.json scripts/sage-form-harness.mjs package.json
git commit -m "test(forms): add form-ranking eval harness + baseline"
```

---

# PHASE 1 — Curated OKF nodes for the ambiguous student-facing set

## Task 1.1: Catalog schema types

**Files:**
- Create: `src/lib/catalog/schema.ts`

**Interfaces:**
- Produces: `CatalogNodeType`, `CatalogStatus`, `CatalogAudience`, `CatalogFrontmatter`, `CatalogNodeSections`, `CatalogNode`, `FormRoutingEntry`, `FormRoutingOverlay`. Every later task imports from here.

- [ ] **Step 1: Write the types.** (No test — pure type declarations.)

```typescript
export type CatalogNodeType = "form" | "program_document" | "certification" | "platform";
export type CatalogStatus = "draft" | "approved";
export type CatalogAudience = "STUDENT" | "TEACHER" | "BOTH";

export interface CatalogFrontmatter {
  type: CatalogNodeType;
  title: string;
  description: string;
  resource: string;
  tags: string[];
  timestamp: string; // YYYY-MM-DD
  vq_id: string;
  vq_audience: CatalogAudience;
  vq_category: string;
  vq_certification?: string;
  vq_platform?: string;
  vq_storage_key?: string;
  vq_status: CatalogStatus;
}

export interface CatalogNodeSections {
  whenToUse: string;
  whenNotToUse: string;
  related: string;
}

export interface CatalogNode {
  frontmatter: CatalogFrontmatter;
  sections: CatalogNodeSections;
  body: string;
  filePath: string;
}

export interface FormRoutingEntry {
  formId: string;
  whenToUse: string;
  tags: string[];
}

export interface FormRoutingOverlay {
  version: 1;
  entries: Record<string, FormRoutingEntry>;
}
```

- [ ] **Step 2: Commit.**

```bash
git add src/lib/catalog/schema.ts
git commit -m "feat(catalog): shared node + overlay types"
```

## Task 1.2: Markdown node parser (gray-matter)

**Files:**
- Create: `src/lib/catalog/parse.ts`, `src/lib/catalog/parse.test.ts`
- Modify: `package.json` (add `gray-matter`)

**Interfaces:**
- Consumes: `CatalogNode`, `CatalogNodeSections` from `./schema`.
- Produces: `parseCatalogNode(raw: string, filePath: string): CatalogNode`, `extractSections(body: string): CatalogNodeSections`.

- [ ] **Step 1: Add the dependency.** `gray-matter` is the de-facto frontmatter parser (bundles js-yaml + its own TypeScript declarations); a hand-rolled parser breaks on colons in `description`.

Run: `npm install gray-matter`  (there is no `@types/gray-matter` package — types ship with gray-matter.)

- [ ] **Step 2: Write the failing test** (`src/lib/catalog/parse.test.ts`).

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCatalogNode, extractSections } from "./parse";

const SAMPLE = `---
type: form
title: "Student Profile: Intake"
description: "Intake form: contact + demographic details"
resource: /api/forms/download?formId=student-profile&mode=view
tags: [onboarding, intake]
timestamp: 2026-06-30
vq_id: student-profile
vq_audience: BOTH
vq_category: onboarding
vq_storage_key: forms/Student-Profile.pdf
vq_status: draft
---
## When to use
At first arrival, for new enrollment.

## When NOT to use
Not for returning students — use the re-entry form.

## Related
Enrolls toward [Ready to Work](../certifications/ready-to-work.md).
`;

describe("parseCatalogNode", () => {
  it("parses frontmatter including values with colons", () => {
    const node = parseCatalogNode(SAMPLE, "catalog/forms/student-profile.md");
    assert.equal(node.frontmatter.type, "form");
    assert.equal(node.frontmatter.description, "Intake form: contact + demographic details");
    assert.deepEqual(node.frontmatter.tags, ["onboarding", "intake"]);
  });
  it("extracts the three body sections", () => {
    const node = parseCatalogNode(SAMPLE, "x.md");
    assert.match(node.sections.whenToUse, /first arrival/);
    assert.match(node.sections.whenNotToUse, /returning students/);
    assert.match(node.sections.related, /Ready to Work/);
  });
});

describe("extractSections", () => {
  it("returns empty strings for missing sections", () => {
    const s = extractSections("## When to use\nhi\n");
    assert.equal(s.whenToUse, "hi");
    assert.equal(s.whenNotToUse, "");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `npx tsx --test src/lib/catalog/parse.test.ts`
Expected: FAIL ("Cannot find module './parse'").

- [ ] **Step 4: Implement** (`src/lib/catalog/parse.ts`).

```typescript
import matter from "gray-matter";
import type { CatalogFrontmatter, CatalogNode, CatalogNodeSections } from "./schema";

export function extractSections(body: string): CatalogNodeSections {
  const get = (heading: string): string => {
    const re = new RegExp(`(?:^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    const m = body.match(re);
    return m ? m[1].trim() : "";
  };
  return {
    whenToUse: get("When to use"),
    whenNotToUse: get("When NOT to use"),
    related: get("Related"),
  };
}

export function parseCatalogNode(raw: string, filePath: string): CatalogNode {
  const { data, content } = matter(raw);
  return {
    frontmatter: data as CatalogFrontmatter,
    sections: extractSections(content),
    body: content,
    filePath,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `npx tsx --test src/lib/catalog/parse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit.**

```bash
git add src/lib/catalog/parse.ts src/lib/catalog/parse.test.ts package.json package-lock.json
git commit -m "feat(catalog): markdown node parser via gray-matter"
```

## Task 1.3: Phase-1 allowlist config

**Files:**
- Create: `config/catalog-allowlist.json`

**Interfaces:**
- Produces: the allowlist consumed by generator + validator. Shape: `{ forms: string[]; documents: string[]; certifications: {id,title}[]; platforms: {id,title}[] }`.

- [ ] **Step 1: Build the allowlist** by reading `src/lib/spokes/forms.ts` and selecting ONLY the confusable, student-facing items. Verify every `forms[]` id against `getFormById`; verify every `documents[]` storageKey exists in `ProgramDocument` (`npm run sage:rag:audit` lists them). Include only the certs/platforms those items cross-link to.

```json
{
  "forms": [
    "dfa-ts-12", "dfa-wvw-70", "dfa-wvw-25", "dfa-prc-1", "dfa-ssp-1",
    "attendance-contract", "media-release", "rights-responsibilities",
    "technology-use", "student-profile"
  ],
  "documents": [],
  "certifications": [
    { "id": "ready-to-work", "title": "Ready to Work Certificate" }
  ],
  "platforms": []
}
```

> The implementer MUST replace the placeholder ids above with the exact ids present in `forms.ts`. If a listed id is not found, the generator (Task 1.5) will fail loudly — that is the verification.

- [ ] **Step 2: Commit.**

```bash
git add config/catalog-allowlist.json
git commit -m "chore(catalog): Phase-1 ambiguous-set allowlist"
```

## Task 1.4: Skeleton generator (pure) + catalog scaffold

**Files:**
- Create: `src/lib/catalog/generate.ts`, `src/lib/catalog/generate.test.ts`

**Interfaces:**
- Consumes: `CatalogFrontmatter`, `CatalogNode` from `./schema`; `SpokesForm` from `@/lib/spokes/forms`.
- Produces: `mapFormAudience(a: SpokesForm["audience"]): CatalogAudience`; `buildFormNodeMarkdown(form: SpokesForm): string`; `buildTaxonomyNodeMarkdown(type, id, title): string`.

- [ ] **Step 1: Write the failing test** (`src/lib/catalog/generate.test.ts`).

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapFormAudience, buildFormNodeMarkdown } from "./generate";
import { parseCatalogNode } from "./parse";

const FORM = {
  id: "dfa-ts-12", title: "DFA-TS-12 Timesheet", description: "Weekly participant timesheet.",
  category: "dohs", fileName: "DFA-TS-12.pdf", storageKey: "forms/DFA-TS-12.pdf",
  fillable: true, required: true, audience: "both", acceptsSubmission: true,
  requiresSignature: true, sortOrder: 10,
} as const;

describe("generate", () => {
  it("maps form audience to uppercase", () => {
    assert.equal(mapFormAudience("instructor"), "TEACHER");
    assert.equal(mapFormAudience("both"), "BOTH");
  });
  it("emits a draft node with derived hard identity and empty soft sections", () => {
    const md = buildFormNodeMarkdown(FORM);
    const node = parseCatalogNode(md, "catalog/forms/dfa-ts-12.md");
    assert.equal(node.frontmatter.type, "form");
    assert.equal(node.frontmatter.vq_id, "dfa-ts-12");
    assert.equal(node.frontmatter.vq_audience, "BOTH");
    assert.equal(node.frontmatter.vq_category, "dohs");
    assert.equal(node.frontmatter.vq_storage_key, "forms/DFA-TS-12.pdf");
    assert.equal(node.frontmatter.vq_status, "draft");
    assert.equal(node.sections.whenToUse, ""); // soft fields left for the drafting pass
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `npx tsx --test src/lib/catalog/generate.test.ts` → FAIL.

- [ ] **Step 3: Implement** (`src/lib/catalog/generate.ts`).

```typescript
import matter from "gray-matter";
import type { SpokesForm } from "@/lib/spokes/forms";
import { buildFormDownloadUrl } from "@/lib/spokes/forms";
import type { CatalogAudience, CatalogFrontmatter } from "./schema";

export function mapFormAudience(a: SpokesForm["audience"]): CatalogAudience {
  if (a === "instructor") return "TEACHER";
  if (a === "student") return "STUDENT";
  return "BOTH";
}

const EMPTY_BODY = `## When to use\n\n## When NOT to use\n\n## Related\n`;

function emit(fm: CatalogFrontmatter, body: string): string {
  // gray-matter stringify writes frontmatter + body deterministically.
  return matter.stringify(body, fm as unknown as Record<string, unknown>);
}

export function buildFormNodeMarkdown(form: SpokesForm): string {
  const fm: CatalogFrontmatter = {
    type: "form",
    title: form.title,
    description: form.description,
    resource: buildFormDownloadUrl(form, "view"),
    tags: [],
    timestamp: "2026-06-30",
    vq_id: form.id,
    vq_audience: mapFormAudience(form.audience),
    vq_category: form.category,
    vq_storage_key: form.storageKey ?? undefined,
    vq_status: "draft",
  };
  return emit(fm, EMPTY_BODY);
}

export function buildTaxonomyNodeMarkdown(
  type: "certification" | "platform",
  id: string,
  title: string,
): string {
  const fm: CatalogFrontmatter = {
    type, title, description: "", resource: "", tags: [], timestamp: "2026-06-30",
    vq_id: id, vq_audience: "BOTH", vq_category: type, vq_status: "draft",
  };
  return emit(fm, EMPTY_BODY);
}
```

> `timestamp` is a fixed literal because `Date.now()` is unavailable in some runtimes and keeps tests deterministic; the CLI (Task 1.6) overwrites it with the real date at write time.

- [ ] **Step 4: Run to verify it passes.** `npx tsx --test src/lib/catalog/generate.test.ts` → PASS.

- [ ] **Step 5: Create the catalog scaffold** (section dirs + `index.md`; `catalog/log.md` already exists from Task 0.1).

```bash
mkdir -p catalog/forms catalog/documents catalog/certifications catalog/platforms
```

Create `catalog/index.md`:

```markdown
---
type: index
title: VisionQuest Org-Knowledge Catalog
timestamp: 2026-06-30
---
# VisionQuest Org-Knowledge Catalog

OKF catalog of organizational knowledge (forms, documents, certifications, platforms).
Curated routing notes here sync into Sage's retrieval. **No student PII.**

- [Forms](./forms/index.md)
- [Documents](./documents/index.md)
- [Certifications](./certifications/index.md)
- [Platforms](./platforms/index.md)

See [log.md](./log.md) for change history and eval baselines.
```

(`catalog/log.md` already exists from Task 0.1 — do not recreate it; Task 1.11 appends the after-numbers.)

- [ ] **Step 6: Commit.**

```bash
git add src/lib/catalog/generate.ts src/lib/catalog/generate.test.ts catalog/index.md
git commit -m "feat(catalog): skeleton generator + catalog scaffold"
```

## Task 1.5: Generator CLI — emit draft skeletons for the allowlist

**Files:**
- Create: `scripts/catalog/generate.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `buildFormNodeMarkdown`, `buildTaxonomyNodeMarkdown` from `../../src/lib/catalog/generate.ts`; `getFormById` from `../../src/lib/spokes/forms.ts`; the allowlist JSON.
- Produces: draft `.md` files under `catalog/`; section `index.md` files. Idempotent: refreshes frontmatter, never overwrites a file whose `vq_status: approved` or whose soft sections are non-empty.

- [ ] **Step 1: Write the CLI.**

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import matter from "gray-matter";

async function main() {
  const allow = JSON.parse(readFileSync("config/catalog-allowlist.json", "utf8"));
  const { getFormById } = await import("../../src/lib/spokes/forms.ts");
  const { buildFormNodeMarkdown, buildTaxonomyNodeMarkdown } = await import("../../src/lib/catalog/generate.ts");
  const today = new Date().toISOString().slice(0, 10);
  const HARD_FIELDS = ["type", "title", "resource", "vq_id", "vq_audience", "vq_category", "vq_certification", "vq_platform", "vq_storage_key"];

  // Existing node: refresh ONLY hard identity; preserve curated soft frontmatter
  // (description, tags), vq_status, timestamp, and the whole body. New node: full skeleton.
  const writeNode = (path, markdown) => {
    const fresh = matter(markdown);
    if (existsSync(path)) {
      const cur = matter(readFileSync(path, "utf8"));
      const merged = { ...cur.data };
      for (const k of HARD_FIELDS) {
        if (fresh.data[k] !== undefined) merged[k] = fresh.data[k];
        else delete merged[k]; // hard field no longer applies (e.g. cert removed at source)
      }
      writeFileSync(path, matter.stringify(cur.content, merged));
      return;
    }
    writeFileSync(path, matter.stringify(fresh.content, { ...fresh.data, timestamp: today }));
  };

  for (const id of allow.forms) {
    const form = getFormById(id);
    if (!form) throw new Error(`Allowlist form id not found in forms.ts: ${id}`);
    writeNode(`catalog/forms/${id}.md`, buildFormNodeMarkdown(form));
  }
  for (const c of allow.certifications) writeNode(`catalog/certifications/${c.id}.md`, buildTaxonomyNodeMarkdown("certification", c.id, c.title));
  for (const p of allow.platforms) writeNode(`catalog/platforms/${p.id}.md`, buildTaxonomyNodeMarkdown("platform", p.id, p.title));

  // Regenerate section index.md files from the directory contents.
  for (const dir of ["forms", "documents", "certifications", "platforms"]) {
    const files = existsSync(`catalog/${dir}`) ? readdirSync(`catalog/${dir}`).filter((f) => f.endsWith(".md") && f !== "index.md") : [];
    const links = files.map((f) => `- [${f.replace(/\.md$/, "")}](./${f})`).join("\n");
    writeFileSync(`catalog/${dir}/index.md`, `# ${dir}\n\n${links}\n`);
  }
  console.log(`Generated ${allow.forms.length} form, ${allow.certifications.length} cert, ${allow.platforms.length} platform skeletons.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add npm script.** In `package.json`, after the `sage:form:harness` line:

```json
"catalog:generate": "tsx scripts/catalog/generate.mjs",
```

- [ ] **Step 3: Run it.**

Run: `npm run catalog:generate`
Expected: prints counts; creates `catalog/forms/*.md` (one per allowlist id), `catalog/certifications/*.md`, section `index.md` files. Every node is `vq_status: draft` with empty soft sections.

- [ ] **Step 4: Verify idempotency.** Run `npm run catalog:generate` again. Expected: no diff for content already present (`git status` shows clean for catalog/ except index regeneration).

- [ ] **Step 5: Commit.**

```bash
git add scripts/catalog/generate.mjs package.json catalog/
git commit -m "feat(catalog): generator CLI emits allowlist skeletons"
```

## Task 1.6: Validator (pure) + CLI + CI wiring

**Files:**
- Create: `src/lib/catalog/validate.ts`, `src/lib/catalog/validate.test.ts`
- Create: `scripts/catalog/validate.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `CatalogNode`, `CatalogNodeType` from `./schema`.
- Produces: `validateNode(node, expected, ctx): ValidationError[]`; `ValidationError { filePath; rule; message }`; `ExpectedHardFields`.

- [ ] **Step 1: Write the failing test** (`src/lib/catalog/validate.test.ts`).

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateNode, type ExpectedHardFields } from "./validate";
import type { CatalogNode } from "./schema";

function node(over: Partial<CatalogNode["frontmatter"]> = {}, sections = {}): CatalogNode {
  return {
    frontmatter: {
      type: "form", title: "T", description: "d", resource: "r", tags: [], timestamp: "2026-06-30",
      vq_id: "dfa-ts-12", vq_audience: "BOTH", vq_category: "dohs",
      vq_storage_key: "forms/DFA-TS-12.pdf", vq_status: "approved", ...over,
    },
    sections: { whenToUse: "use it", whenNotToUse: "", related: "", ...sections },
    body: "", filePath: "catalog/forms/dfa-ts-12.md",
  };
}
const expected: ExpectedHardFields = {
  type: "form", title: "T", vq_audience: "BOTH", vq_category: "dohs", vq_storage_key: "forms/DFA-TS-12.pdf",
};
const ctx = { existingNodePaths: new Set<string>(), allowlistIds: ["dfa-ts-12"] };

describe("validateNode", () => {
  it("passes a well-formed approved node", () => {
    assert.deepEqual(validateNode(node(), expected, ctx), []);
  });
  it("flags a missing type", () => {
    const errs = validateNode(node({ type: undefined as never }), expected, ctx);
    assert.ok(errs.some((e) => e.rule === "type"));
  });
  it("flags hard-field drift", () => {
    const errs = validateNode(node({ vq_category: "onboarding" }), expected, ctx);
    assert.ok(errs.some((e) => e.rule === "drift"));
  });
  it("flags an approved node with an empty when-to-use", () => {
    const errs = validateNode(node({}, { whenToUse: "" }), expected, ctx);
    assert.ok(errs.some((e) => e.rule === "empty-approved"));
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `npx tsx --test src/lib/catalog/validate.test.ts` → FAIL.

- [ ] **Step 3: Implement** (`src/lib/catalog/validate.ts`).

```typescript
import type { CatalogNode, CatalogNodeType } from "./schema";

export interface ValidationError { filePath: string; rule: string; message: string; }
export interface ExpectedHardFields {
  type: CatalogNodeType; title: string; vq_audience: string; vq_category: string;
  vq_storage_key?: string; vq_certification?: string; vq_platform?: string;
}
export interface ValidateContext { existingNodePaths: Set<string>; allowlistIds: string[]; }

const TYPES: CatalogNodeType[] = ["form", "program_document", "certification", "platform"];
const AUDIENCES = ["STUDENT", "TEACHER", "BOTH"];

export function validateNode(node: CatalogNode, expected: ExpectedHardFields, ctx: ValidateContext): ValidationError[] {
  const errs: ValidationError[] = [];
  const fp = node.filePath;
  const fm = node.frontmatter;
  const push = (rule: string, message: string) => errs.push({ filePath: fp, rule, message });

  if (!fm.type || !TYPES.includes(fm.type)) push("type", `type must be one of ${TYPES.join("|")}`);
  if (!fm.title) push("required", "title is required");
  if (!AUDIENCES.includes(fm.vq_audience)) push("required", "vq_audience invalid");
  if (fm.vq_status !== "draft" && fm.vq_status !== "approved") push("required", "vq_status invalid");

  for (const [k, v] of Object.entries(expected) as [keyof ExpectedHardFields, string | undefined][]) {
    if ((fm as Record<string, unknown>)[k] !== v) push("drift", `${k} drifted: catalog=${(fm as Record<string, unknown>)[k]} source=${v}`);
  }

  if (fm.vq_status === "approved" && !node.sections.whenToUse.trim()) push("empty-approved", "approved node has empty 'When to use'");

  // Cross-link integrity: every relative .md link in Related must resolve.
  const links = [...node.sections.related.matchAll(/\]\((\.\.?\/[^)]+\.md)\)/g)].map((m) => m[1]);
  for (const link of links) {
    if (!ctx.existingNodePaths.has(normalizeLink(fp, link))) push("link", `broken cross-link: ${link}`);
  }

  if (!ctx.allowlistIds.includes(fm.vq_id)) push("parity", `node not in allowlist: ${fm.vq_id}`);
  return errs;
}

function normalizeLink(fromPath: string, link: string): string {
  const parts = fromPath.split("/").slice(0, -1);
  for (const seg of link.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
```

- [ ] **Step 4: Run to verify it passes.** `npx tsx --test src/lib/catalog/validate.test.ts` → PASS (4 tests).

- [ ] **Step 5: Write the validator CLI** (`scripts/catalog/validate.mjs`) — loads every node, builds expected hard fields from `forms.ts` + allowlist, checks parity both directions (every allowlist id has a node), exits non-zero on any error.

```javascript
#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from "node:fs";

async function main() {
  const allow = JSON.parse(readFileSync("config/catalog-allowlist.json", "utf8"));
  const { getFormById, buildFormDownloadUrl } = await import("../../src/lib/spokes/forms.ts");
  const { parseCatalogNode } = await import("../../src/lib/catalog/parse.ts");
  const { mapFormAudience } = await import("../../src/lib/catalog/generate.ts");
  const { validateNode } = await import("../../src/lib/catalog/validate.ts");

  const dirs = ["forms", "documents", "certifications", "platforms"];
  const nodes = [];
  const existingNodePaths = new Set();
  for (const d of dirs) {
    if (!existsSync(`catalog/${d}`)) continue;
    for (const f of readdirSync(`catalog/${d}`).filter((x) => x.endsWith(".md") && x !== "index.md")) {
      const fp = `catalog/${d}/${f}`;
      existingNodePaths.add(fp);
      nodes.push(parseCatalogNode(readFileSync(fp, "utf8"), fp));
    }
  }
  const allowlistIds = [...allow.forms, ...allow.certifications.map((c) => c.id), ...allow.platforms.map((p) => p.id)];
  const ctx = { existingNodePaths, allowlistIds };

  let errors = [];
  for (const node of nodes) {
    let expected;
    if (node.frontmatter.type === "form") {
      const form = getFormById(node.frontmatter.vq_id);
      if (!form) { errors.push({ filePath: node.filePath, rule: "parity", message: "no source form" }); continue; }
      expected = { type: "form", title: form.title, vq_audience: mapFormAudience(form.audience), vq_category: form.category, vq_storage_key: form.storageKey ?? undefined };
    } else {
      expected = { type: node.frontmatter.type, title: node.frontmatter.title, vq_audience: node.frontmatter.vq_audience, vq_category: node.frontmatter.vq_category };
    }
    errors.push(...validateNode(node, expected, ctx));
  }
  // Parity (other direction): every allowlisted form has a node.
  for (const id of allow.forms) {
    if (!existingNodePaths.has(`catalog/forms/${id}.md`)) errors.push({ filePath: `catalog/forms/${id}.md`, rule: "parity", message: "allowlisted form has no node" });
  }

  if (errors.length) {
    for (const e of errors) console.error(`[${e.rule}] ${e.filePath}: ${e.message}`);
    console.error(`\n${errors.length} validation error(s).`);
    process.exit(1);
  }
  console.log(`Catalog valid: ${nodes.length} nodes, 0 errors.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Add npm script + run.** In `package.json` after `catalog:generate`:

```json
"catalog:validate": "tsx scripts/catalog/validate.mjs",
```

Run: `npm run catalog:validate`
Expected: drafts pass structural checks (they will report `empty-approved` only once nodes are approved — at this point all are `draft`, so PASS).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/catalog/validate.ts src/lib/catalog/validate.test.ts scripts/catalog/validate.mjs package.json
git commit -m "feat(catalog): validator (drift/links/parity/FERPA) + CLI"
```

## Task 1.7: Drafting pass + human approval (content gate)

**Files:**
- Modify: `catalog/forms/*.md`, `catalog/certifications/*.md`, `catalog/platforms/*.md` (soft sections only)

**This task is content authoring + review, not code. No test cycle; the validator (1.6) is the gate.**

- [ ] **Step 1: Draft soft routing content.** For each draft node, fill `description`, `tags`, `## When to use`, `## When NOT to use`, and `## Related` (cross-links to the cert/platform nodes). For each pair of confusable forms, the `When NOT to use` MUST name the sibling explicitly (e.g., DFA-TS-12: "NOT for participation status — that's DFA-WVW-70"). **FERPA: do not copy any filled example, name, address, or per-person text from source PDFs. Do not open scanned-image docs for drafting.**
- [ ] **Step 2: Human review.** Owner/teacher reviews each node for accuracy. On approval, set `vq_status: approved`.
- [ ] **Step 3: Validate.** Run `npm run catalog:validate`. Expected: 0 errors (approved nodes now have non-empty When-to-use; no drift; links resolve).
- [ ] **Step 4: Commit.**

```bash
git add catalog/
git commit -m "docs(catalog): curated routing notes for ambiguous set (approved)"
```

## Task 1.8: Overlay builder (pure) + form-routing sync CLI

**Files:**
- Create: `src/lib/catalog/sync.ts`, `src/lib/catalog/sync.test.ts`
- Create: `scripts/catalog/sync.mjs`
- Modify: `package.json` (scripts), `scripts/prepare-standalone-assets.mjs`

**Interfaces:**
- Consumes: `CatalogNode`, `FormRoutingOverlay`, `FormRoutingEntry` from `./schema`.
- Produces: `buildFormRoutingOverlay(approvedFormNodes: CatalogNode[]): FormRoutingOverlay`; `buildDocNote(node: CatalogNode): string`; `buildDocSyncManifest(approvedDocNodes, dbDocsByStorageKey): DocUpdate[]`; `DocUpdate { docId; storageKey; newNote }`.

- [ ] **Step 1: Write the failing test** (`src/lib/catalog/sync.test.ts`).

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFormRoutingOverlay, buildDocNote, buildDocSyncManifest } from "./sync";
import type { CatalogNode } from "./schema";

function n(over: Partial<CatalogNode["frontmatter"]>, sections: Partial<CatalogNode["sections"]>): CatalogNode {
  return {
    frontmatter: { type: "form", title: "T", description: "d", resource: "r", tags: ["a"], timestamp: "2026-06-30",
      vq_id: "dfa-ts-12", vq_audience: "BOTH", vq_category: "dohs", vq_status: "approved", ...over },
    sections: { whenToUse: "Use weekly for hours.", whenNotToUse: "Not for status (use DFA-WVW-70).", related: "", ...sections },
    body: "", filePath: "x.md",
  };
}

describe("buildFormRoutingOverlay", () => {
  it("keys entries by formId with note + tags", () => {
    const o = buildFormRoutingOverlay([n({ vq_id: "dfa-ts-12", tags: ["timesheet"] }, {})]);
    assert.equal(o.version, 1);
    assert.equal(o.entries["dfa-ts-12"].tags[0], "timesheet");
    assert.match(o.entries["dfa-ts-12"].whenToUse, /weekly/);
  });
});

describe("buildDocNote", () => {
  it("combines description + when-to-use + when-not", () => {
    const note = buildDocNote(n({ type: "program_document", description: "RTW overview." }, {}));
    assert.match(note, /RTW overview/);
    assert.match(note, /Use weekly/);
    assert.match(note, /Not for status/);
  });
});

describe("buildDocSyncManifest", () => {
  it("maps approved doc nodes to existing DB docs by storageKey", () => {
    const node = n({ type: "program_document", vq_id: "rtw", vq_storage_key: "ready-to-work/RTW.pdf" }, {});
    const manifest = buildDocSyncManifest([node], new Map([["ready-to-work/RTW.pdf", { id: "doc_1" }]]));
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].docId, "doc_1");
  });
  it("skips doc nodes with no matching DB row", () => {
    const node = n({ type: "program_document", vq_storage_key: "missing.pdf" }, {});
    assert.deepEqual(buildDocSyncManifest([node], new Map()), []);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `npx tsx --test src/lib/catalog/sync.test.ts` → FAIL.

- [ ] **Step 3: Implement** (`src/lib/catalog/sync.ts`).

```typescript
import type { CatalogNode, FormRoutingEntry, FormRoutingOverlay } from "./schema";

export interface DocUpdate { docId: string; storageKey: string; newNote: string; }

export function buildDocNote(node: CatalogNode): string {
  const parts = [node.frontmatter.description, node.sections.whenToUse, node.sections.whenNotToUse]
    .map((s) => s.trim()).filter(Boolean);
  return parts.join(" ");
}

export function buildFormRoutingOverlay(approvedFormNodes: CatalogNode[]): FormRoutingOverlay {
  const entries: Record<string, FormRoutingEntry> = {};
  for (const node of approvedFormNodes) {
    if (node.frontmatter.type !== "form" || node.frontmatter.vq_status !== "approved") continue;
    entries[node.frontmatter.vq_id] = {
      formId: node.frontmatter.vq_id,
      whenToUse: [node.sections.whenToUse, node.sections.whenNotToUse].map((s) => s.trim()).filter(Boolean).join(" "),
      tags: node.frontmatter.tags ?? [],
    };
  }
  return { version: 1, entries };
}

export function buildDocSyncManifest(
  approvedDocNodes: CatalogNode[],
  dbDocsByStorageKey: Map<string, { id: string }>,
): DocUpdate[] {
  const out: DocUpdate[] = [];
  for (const node of approvedDocNodes) {
    if (node.frontmatter.type !== "program_document" || node.frontmatter.vq_status !== "approved") continue;
    const key = node.frontmatter.vq_storage_key;
    if (!key) continue;
    const row = dbDocsByStorageKey.get(key);
    if (!row) continue;
    out.push({ docId: row.id, storageKey: key, newNote: buildDocNote(node) });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes.** `npx tsx --test src/lib/catalog/sync.test.ts` → PASS.

- [ ] **Step 5: Write the sync CLI** (`scripts/catalog/sync.mjs`) — loads approved nodes, prints a dry-run manifest, and only on `--apply` writes the overlay, updates+re-embeds docs, and invalidates the cache.

```javascript
#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "../lib/sage-rag-utils.mjs";

loadEnvFile();

async function main() {
  const apply = process.argv.includes("--apply");
  const { parseCatalogNode } = await import("../../src/lib/catalog/parse.ts");
  const { buildFormRoutingOverlay, buildDocSyncManifest } = await import("../../src/lib/catalog/sync.ts");

  const load = (dir) => (existsSync(`catalog/${dir}`) ? readdirSync(`catalog/${dir}`) : [])
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => parseCatalogNode(readFileSync(`catalog/${dir}/${f}`, "utf8"), `catalog/${dir}/${f}`));

  const formNodes = load("forms").filter((n) => n.frontmatter.vq_status === "approved");
  const docNodes = load("documents").filter((n) => n.frontmatter.vq_status === "approved");

  // Form overlay
  const overlay = buildFormRoutingOverlay(formNodes);
  console.log(`FORM OVERLAY: ${Object.keys(overlay.entries).length} entries`);

  // Doc manifest (needs DB)
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const keys = docNodes.map((n) => n.frontmatter.vq_storage_key).filter(Boolean);
  const rows = keys.length ? await prisma.programDocument.findMany({ where: { storageKey: { in: keys } }, select: { id: true, storageKey: true } }) : [];
  const byKey = new Map(rows.map((r) => [r.storageKey, { id: r.id }]));
  const manifest = buildDocSyncManifest(docNodes, byKey);
  console.log(`DOC UPDATES: ${manifest.length}`);
  for (const u of manifest) console.log(`  ${u.storageKey} -> note(${u.newNote.length} chars)`);

  if (!apply) { console.log("\nDRY RUN. Re-run with --apply to write."); await prisma.$disconnect(); return; }

  // Apply overlay
  writeFileSync("config/form-routing.generated.json", JSON.stringify(overlay, null, 2) + "\n");

  // Apply doc updates. Re-embed FIRST (vector reflects the new note), THEN write the
  // note row — so an embed failure leaves note+vector both OLD (consistent), never the
  // stale-vector state. Docs whose clean body text is unavailable are SKIPPED entirely
  // (never partially updated). Per-doc try/catch; the drift audit (Task 1.10) catches any
  // rare embed-ok/note-write-failed window.
  const { embedProgramDocument } = await import("../../src/lib/sage/document-embedding.ts");
  const { extractPagesFromBuffer, containsPII } = await import("../../src/lib/sage/extract.ts");
  const { downloadBundledFile } = await import("../../src/lib/storage.ts");
  const { invalidatePrefix } = await import("../../src/lib/cache.ts");
  let applied = 0;
  for (const u of manifest) {
    try {
      const doc = await prisma.programDocument.findUnique({ where: { id: u.docId }, select: { title: true, storageKey: true } });
      if (!doc) { console.warn(`  SKIP ${u.storageKey}: doc not found`); continue; }
      const dl = await downloadBundledFile(doc.storageKey); // { buffer, mimeType } | null
      if (!dl) { console.warn(`  SKIP ${u.storageKey}: source bytes unavailable (left unchanged)`); continue; }
      const ext = doc.storageKey.slice(doc.storageKey.lastIndexOf("."));
      const extracted = await extractPagesFromBuffer(dl.buffer, ext);
      const pages = extracted?.pages ?? [];
      const bodyText = pages.map((p) => p.text).join("\n");
      if (bodyText && containsPII(bodyText)) { console.warn(`  SKIP ${u.storageKey}: PII detected in body — handle manually`); continue; }
      // Re-embed (doc vector from the new note + preserved chunks), then persist the note.
      await embedProgramDocument(u.docId, { title: doc.title, sageContextNote: u.newNote, pages });
      await prisma.programDocument.update({ where: { id: u.docId }, data: { sageContextNote: u.newNote } });
      applied++;
    } catch (e) {
      console.error(`  FAILED ${u.storageKey}: ${e.message} (left unchanged)`);
    }
  }
  invalidatePrefix("sage:documents");
  await prisma.$disconnect();
  console.log(`Applied ${applied}/${manifest.length} doc updates; overlay written; cache invalidated.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Add npm script + ensure overlay ships.** In `package.json` after `catalog:validate`:

```json
"catalog:sync": "tsx scripts/catalog/sync.mjs",
```

In `scripts/prepare-standalone-assets.mjs`, confirm `config/` (or specifically `config/form-routing.generated.json`) is among the copied assets; if a `config` copy is not already present, add it next to where `config/sage-overrides.json` is handled.

- [ ] **Step 7: Dry-run.**

Run: `npm run catalog:sync`
Expected: prints the form overlay entry count + doc update list, ends with "DRY RUN".

- [ ] **Step 8: Apply (after reviewing the dry run).**

Run: `npm run catalog:sync -- --apply`
Expected: writes `config/form-routing.generated.json`; updates+re-embeds any doc nodes; "Applied."

- [ ] **Step 9: Commit.**

```bash
git add src/lib/catalog/sync.ts src/lib/catalog/sync.test.ts scripts/catalog/sync.mjs scripts/prepare-standalone-assets.mjs package.json config/form-routing.generated.json
git commit -m "feat(catalog): sync builds form overlay + re-embeds doc notes"
```

## Task 1.9: Wire form-search to the overlay (+ cache reset)

**Files:**
- Modify: `src/lib/spokes/form-search.ts`
- Modify: `src/lib/spokes/form-search.test.ts`

**Interfaces:**
- Consumes: `FormRoutingOverlay`, `FormRoutingEntry` from `@/lib/catalog/schema`; the generated `config/form-routing.generated.json`.
- Produces: overlay-aware `embeddingTextFor` + `keywordScore`; `__resetFormEmbeddingCache()` also clears the overlay cache.

- [ ] **Step 1: Write the failing test** (extend `src/lib/spokes/form-search.test.ts`). The keyword path must rank a form higher when the overlay adds a matching synonym.

```typescript
import { __setFormRoutingOverlayForTest } from "./form-search";

describe("overlay-aware keyword ranking", () => {
  it("boosts a form whose overlay note matches the query", async () => {
    resetCache();
    __setFormRoutingOverlayForTest({ version: 1, entries: {
      "dress-code": { formId: "dress-code", whenToUse: "what to wear clothing attire", tags: ["attire"] },
    }});
    const result = await searchForms({ query: "what should i wear", role: "student" });
    assert.equal(result.candidates[0].form.id, "dress-code");
    __setFormRoutingOverlayForTest(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `npx tsx --test src/lib/spokes/form-search.test.ts` → FAIL (`__setFormRoutingOverlayForTest` not exported).

- [ ] **Step 3: Implement overlay loading + use.** In `src/lib/spokes/form-search.ts`:

```typescript
import { readFileSync, existsSync } from "node:fs";
import type { FormRoutingOverlay, FormRoutingEntry } from "@/lib/catalog/schema";

let overlayCache: FormRoutingOverlay | null | undefined;
function getOverlay(): FormRoutingOverlay | null {
  if (overlayCache !== undefined) return overlayCache;
  try {
    const p = "config/form-routing.generated.json";
    overlayCache = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as FormRoutingOverlay) : null;
  } catch { overlayCache = null; }
  return overlayCache;
}
export function __setFormRoutingOverlayForTest(o: FormRoutingOverlay | null): void { overlayCache = o; }
```

Update `embeddingTextFor` to append the overlay note, and `keywordScore` to add overlay tags/note tokens:

```typescript
function embeddingTextFor(form: SpokesForm): string {
  const categoryLabel = FORM_CATEGORIES[form.category]?.label ?? form.category;
  const base = `${form.title}. ${form.description}. Category: ${categoryLabel}.`;
  const entry = getOverlay()?.entries[form.id];
  return entry?.whenToUse ? `${base} ${entry.whenToUse}` : base;
}
```

In `keywordScore`, fold overlay text into the form's searchable token set (add `entry.whenToUse` + `entry.tags.join(" ")` to whatever string the function currently tokenizes from the form). Keep the existing title-hit boost.

Update `__resetFormEmbeddingCache` to also clear `overlayCache`:

```typescript
export function __resetFormEmbeddingCache(): void {
  formEmbeddingCache = null;
  formEmbeddingInit = null;
  overlayCache = undefined; // re-read overlay on next search
}
```

- [ ] **Step 4: Run to verify it passes.** `npx tsx --test src/lib/spokes/form-search.test.ts` → PASS (existing + new tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/spokes/form-search.ts src/lib/spokes/form-search.test.ts
git commit -m "feat(forms): form-search consumes catalog routing overlay"
```

## Task 1.10: Drift audit (DB note vs approved node)

**Files:**
- Create: `src/lib/catalog/drift-audit.ts`, `src/lib/catalog/drift-audit.test.ts`
- Create: `scripts/catalog/drift.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `CatalogNode` from `./schema`; `buildDocNote` from `./sync`.
- Produces: `findNoteDrift(approvedDocNodes, dbDocsByStorageKey): DriftFinding[]`; `DriftFinding { storageKey; expected; actual }`.

- [ ] **Step 1: Write the failing test** (`src/lib/catalog/drift-audit.test.ts`).

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findNoteDrift } from "./drift-audit";
import type { CatalogNode } from "./schema";

const node = {
  frontmatter: { type: "program_document", title: "T", description: "RTW.", resource: "", tags: [], timestamp: "2026-06-30",
    vq_id: "rtw", vq_audience: "BOTH", vq_category: "READY_TO_WORK", vq_storage_key: "rtw/RTW.pdf", vq_status: "approved" },
  sections: { whenToUse: "Use at completion.", whenNotToUse: "", related: "" }, body: "", filePath: "x.md",
} as CatalogNode;

describe("findNoteDrift", () => {
  it("flags when the DB note differs from the catalog-derived note", () => {
    const findings = findNoteDrift([node], new Map([["rtw/RTW.pdf", { sageContextNote: "stale text" }]]));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].storageKey, "rtw/RTW.pdf");
  });
  it("is silent when they match", () => {
    const findings = findNoteDrift([node], new Map([["rtw/RTW.pdf", { sageContextNote: "RTW. Use at completion." }]]));
    assert.deepEqual(findings, []);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `npx tsx --test src/lib/catalog/drift-audit.test.ts` → FAIL.

- [ ] **Step 3: Implement** (`src/lib/catalog/drift-audit.ts`).

```typescript
import type { CatalogNode } from "./schema";
import { buildDocNote } from "./sync";

export interface DriftFinding { storageKey: string; expected: string; actual: string | null; }

export function findNoteDrift(
  approvedDocNodes: CatalogNode[],
  dbDocsByStorageKey: Map<string, { sageContextNote: string | null }>,
): DriftFinding[] {
  const out: DriftFinding[] = [];
  for (const node of approvedDocNodes) {
    if (node.frontmatter.type !== "program_document" || node.frontmatter.vq_status !== "approved") continue;
    const key = node.frontmatter.vq_storage_key;
    if (!key) continue;
    const row = dbDocsByStorageKey.get(key);
    if (!row) continue;
    const expected = buildDocNote(node);
    if ((row.sageContextNote ?? "") !== expected) out.push({ storageKey: key, expected, actual: row.sageContextNote });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes.** `npx tsx --test src/lib/catalog/drift-audit.test.ts` → PASS.

- [ ] **Step 5: Write the CLI** (`scripts/catalog/drift.mjs`) — loads approved doc nodes, queries the DB, prints findings, exits non-zero if any drift.

```javascript
#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { loadEnvFile } from "../lib/sage-rag-utils.mjs";
loadEnvFile();

async function main() {
  const { parseCatalogNode } = await import("../../src/lib/catalog/parse.ts");
  const { findNoteDrift } = await import("../../src/lib/catalog/drift-audit.ts");
  const docNodes = (existsSync("catalog/documents") ? readdirSync("catalog/documents") : [])
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => parseCatalogNode(readFileSync(`catalog/documents/${f}`, "utf8"), `catalog/documents/${f}`))
    .filter((n) => n.frontmatter.vq_status === "approved");
  if (!docNodes.length) { console.log("No approved document nodes; nothing to audit."); return; }
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const keys = docNodes.map((n) => n.frontmatter.vq_storage_key).filter(Boolean);
  const rows = await prisma.programDocument.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true, sageContextNote: true } });
  const byKey = new Map(rows.map((r) => [r.storageKey, { sageContextNote: r.sageContextNote }]));
  const findings = findNoteDrift(docNodes, byKey);
  await prisma.$disconnect();
  if (findings.length) {
    for (const f of findings) console.error(`[drift] ${f.storageKey}: DB diverges from catalog`);
    process.exit(1);
  }
  console.log(`No drift: ${docNodes.length} approved doc nodes match the DB.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Add npm script + run.** In `package.json` after `catalog:sync`:

```json
"catalog:drift": "tsx scripts/catalog/drift.mjs",
```

Run: `npm run catalog:drift` → expected: "No drift" (or "nothing to audit" if no doc nodes).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/catalog/drift-audit.ts src/lib/catalog/drift-audit.test.ts scripts/catalog/drift.mjs package.json
git commit -m "feat(catalog): DB-vs-catalog note drift audit"
```

## Task 1.11: Measure against baseline + record (Phase-1 exit gate)

**Files:**
- Modify: `catalog/log.md`

- [ ] **Step 1: Reset the form-search cache** so the new overlay takes effect. For a local run this is process restart; in the harness it's automatic (fresh process). Confirm the deployed strategy is documented in `catalog/log.md` (restart on deploy is sufficient since the overlay file is committed and shipped).
- [ ] **Step 2: Re-run both harnesses.**

Run: `npm run sage:form:harness`
Run: `npm run sage:rag:harness -- --fixture=config/sage-rag-eval.json --role=student --json`

- [ ] **Step 3: Record the after-numbers in `catalog/log.md`** next to the Phase-0 baseline, and compute deltas (top-1/top-3/clean-top-3/forbiddenHits/audienceLeakage).
- [ ] **Step 4: Evaluate the exit gate.** Phase 1 succeeds only if there is a measurable improvement (higher clean-top-3 and/or lower forbiddenHits) with **no regression** in audience leakage. If no improvement, STOP and reassess (do not proceed to Phase 2/3).
- [ ] **Step 5: Run the full test + lint gate.**

Run: `npm test`
Run: `npx eslint .`
Run: `npx prisma validate`
Expected: all green (no schema change, so `prisma validate` is a no-op sanity check).

- [ ] **Step 6: Commit.**

```bash
git add catalog/log.md
git commit -m "docs(catalog): Phase-1 eval results + delta vs baseline"
```

---

## Self-Review (completed by author)

**Spec coverage:** Phase 0 baseline (both pipelines) → Tasks 0.1–0.2. OKF node schema → 1.1. Flat catalog + index/log → 1.4. Generator (idempotent, hard-field-derived) → 1.4–1.5. Drafting→review→approve gate → 1.7. Validator (type/drift/links/parity/FERPA) → 1.6. Sync (overlay + sageContextNote + **re-embed** + **invalidatePrefix**) → 1.8. Form-search overlay wiring + cache reset → 1.9. Drift audit → 1.10. Eval-gated exit → 1.11. FERPA hardening (allowlist, no-copy, exclude images) → Global Constraints + 1.3 + 1.7. No new `ProgramDocument` columns → Global Constraints. Runtime freshness → 1.9 + 1.11. Out-of-scope items (viz, Phase-2 SQL, codebase TOC, per-student nodes) → not implemented.

**Placeholder scan:** the only intentional fill-ins are (a) the allowlist ids in 1.3 (the implementer enumerates from `forms.ts`; generator fails loudly on a bad id) and (b) the baseline numbers in `catalog/log.md` (filled at run time). Both are explicit, gated actions, not vague TODOs.

**Type consistency:** `CatalogNode`/`CatalogFrontmatter`/`FormRoutingOverlay` defined in 1.1 and imported unchanged through 1.2/1.4/1.6/1.8/1.9/1.10. `buildDocNote` defined in 1.8 and reused by 1.10. `mapFormAudience` defined in 1.4 and reused by 1.6's CLI. `__resetFormEmbeddingCache` (existing) extended in 1.9; new `__setFormRoutingOverlayForTest` added in 1.9 and used by its test.
