# Sage Ingest storageKey Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **GATE STATUS: APPROVED + EXECUTED 2026-07-03.** Britt confirmed D1 (refuse+report), D2 (preserve), D3 (skip+report), D4 (accept) verbatim. Implemented on branch `fix/sage-ingest-storagekey`; dry-run verification passed (0 orphan-unmarks, 0 unmapped, 1 missing object = known Finding-B Laubach pptx residue; BYAG avi/mp3 hit the unchanged-skip so their deliberate deactivation is preserved). Live sync remains a separate gate.

**Goal:** Stop `syncSageDocuments()` (src/lib/sage/ingest.ts) from minting ProgramDocument rows that 404 in prod, by making it mint bucket-convention storageKeys (uploader FOLDER_MAP) and refusing to index any file whose object does not exist in the bucket.

**Architecture:** Extract the local-folder→bucket-prefix mapping into `src/lib/storage.ts` (next to the existing reverse map, which becomes derived from it, so forward and reverse can never drift). Add an S3 HeadObject existence helper. Rework the ingest loop to map keys, verify object existence before minting, and preserve teacher-curated fields on update. Add a `--dry-run` mode so future syncs fit the preview→approve→execute house workflow.

**Tech Stack:** TypeScript (strict), Prisma 6, `@aws-sdk/client-s3` (already a dependency), node:test via `npx tsx --test`.

## Investigation facts this plan is built on (verified 2026-07-03, read-only)

- `ingest.ts:260` uses the raw `docs-upload/`-relative path as `storageKey` and never uploads anything. This created 8 of the 14 orphan-set-C rows (all under identity-mapped prefixes `forms/`, `orientation/`, `lms/`).
- The CHECK constraint `program_document_storage_key_shape` **exists in the live DB but in no migration** (applied manually). It rejects raw `teachers/`, `students/`, `presentation/`, `_inventory.txt` keys — which is why the orphans are confined to identity-mapped prefixes. It does NOT block `sage-context/%`.
- 0 rows currently violate the key convention. Prefix counts: teachers 348 (0 sage), lms 112 (24 sage), forms 28 (13 sage), orientation 13 (11 sage), presentations 10 (0 sage), students 2 (2 sage).
- 0 `sage.knowledge_sync` audit events exist → the POST `/api/teacher/documents/sage-context/sync` route has never completed successfully; on Render it throws ENOENT because `docs-upload/` is gitignored and absent. All row minting came from `scripts/seed-sage-context.mjs` run in dev against the shared prod DB. Nothing in the UI calls the route.
- The end-of-sync orphan pass compares raw local paths against DB keys → any sync run would silently unmark `usedBySage` on every Sage doc under a renamed prefix (today: the 2 curated `students/resources/*` docs).
- The upsert's update path overwrites `usedBySage: true`, `isActive: true`, and `sageContextNote` — clobbering the teacher curation UI (PATCH `/api/teacher/documents/sage-context` edits exactly `usedBySage` + `sageContextNote`).
- Seeded rows have null `sizeBytes`/`fileModifiedAt` → the first live post-fix sync will take the update path for ~500 rows (metadata backfill + re-embedding). This is why dry-run + gate matters.
- `docs-upload/sage-context/` exists but is **empty**; the uploader has no FOLDER_MAP entry for it (skips it), so ingest must skip it too until a convention is decided. The uploader also skips `_`/`.`-prefixed files and `.url`/`.ai` files; ingest currently does not.
- The uploader's Section 16 rule (`rest.includes("Section 16")`) and the seeder's (`rest.includes("Handbook Appendix/Section 16/")`) coincide on real data — the only Section 16 dir is `teachers/Handbook Appendix/Section 16/`. The shared module uses the seeder's precise rule.
- `.env.local` now has STORAGE_* S3 creds (populated 2026-07-03), so HeadObject from dev works against the real bucket.

## Decision points (leans — Britt confirms before execution)

| # | Decision | Lean | Alternative considered |
|---|----------|------|------------------------|
| D1 | Refuse-to-mint (verify via HeadObject) vs upload-on-ingest | **Refuse + report.** Ingest stays read-only w.r.t. storage; uploads remain an explicit gated step via `scripts/upload-to-supabase.mjs` (has `--dry-run`). Upload-on-ingest would make a background sync silently PUT to the prod bucket from a dev machine (overwrite risk, no preview gate, 43MB media buffering, silent `./uploads/` divergence when creds absent). The bucket's MIME allowlist ([pdf, jpeg, png, gif, pptx], discovered in the orphan-C execute) would also make upload-on-ingest 415 on media files mid-sync. | Upload-on-ingest via `storage.ts uploadFile` — one-command convenience; rejected for gate-culture and overwrite risk. Can be revisited later as an explicit `--upload-missing` flag if the two-step flow proves annoying. |
| D2 | On update, preserve teacher curation (`usedBySage`, `isActive`, existing `sageContextNote`) | **Preserve.** Sync refreshes file metadata; humans own curation. Create path keeps `usedBySage: true`, `isActive: true`. | Current force-true behavior — would flip all 348 teachers/guides rows into Sage's corpus on first sync and clobber hand-edited notes on every run. |
| D3 | `sage-context/` handling | **Skip + report as `unmapped`** (mirrors uploader). Folder is empty today. When Britt wants it live: add a FOLDER_MAP entry in both the uploader and `storage.ts`, upload, then sync. | Add `"sage-context": "sage-context"` mapping now — rejected: no objects exist, would recreate the orphan class the constraint doesn't block. |
| D4 | Consequence of D2 | Existing note is preserved even when file content changes (stale-summary risk). Regeneration happens only when a row has no note or `config/sage-overrides.json` provides one. | Always regenerate — clobbers curation; rejected. |

## Global Constraints

- Run `npx eslint .` before every commit; `npx prisma validate` not needed (no schema change).
- TypeScript strict; no `any`; no `console.log` in `src/` (scripts may use console).
- Conventional commits; one commit per logical layer; never `--no-verify`.
- **No live sync run and no DB/bucket mutation as part of implementing this plan.** The only permitted runtime verification is `--dry-run`. Live sync is a separate Britt-approved gate, sequenced AFTER the orphan-set-C uploads execute.
- Do not modify `scripts/upload-to-supabase.mjs` / `scripts/seed-documents.mjs` logic (they already match the bucket); comment-only cross-references allowed.
- Branch: create `fix/sage-ingest-storagekey` from up-to-date `main` (current session branch `fix/catalog-crlf-normalization` is unrelated).
- `npm test` is a Windows no-op — run `npx tsx --test <files>` explicitly.

## File Structure

- Modify: `src/lib/storage.ts` — add forward map + `mapLocalPathToStorageKey()` + `isObjectStorageConfigured()` + `storageObjectExists()`; derive the existing reverse map.
- Modify: `src/lib/storage.test.ts` — tests for the new pure function and config detection.
- Modify: `src/lib/sage/ingest.ts` — key mapping, skip rules, refuse-on-missing-object, curation-preserving upsert, dry-run, fail-fast guards, `SyncResult` extension.
- Modify: `src/app/api/teacher/documents/sage-context/sync/route.ts` — surface new result fields in summary/audit metadata.
- Modify: `scripts/seed-sage-context.mjs` — `--dry-run` flag + print new fields.
- Modify: `CLAUDE.md` (repo) — refresh the stale `docs-upload/sage-context/` Known-Issues line.

---

### Task 1: Shared key mapping + existence helpers in storage.ts

**Files:**
- Modify: `src/lib/storage.ts` (imports at :5, reverse map at :104-112, new exports after `inferMimeType`)
- Test: `src/lib/storage.test.ts`

**Interfaces:**
- Consumes: existing `getS3Client()`, `BUCKET`, `s3Client`, `BUNDLED_KEY_PREFIX_TO_LOCAL` internals.
- Produces (used by Task 2):
  - `export function mapLocalPathToStorageKey(relativePath: string): string | null`
  - `export function isObjectStorageConfigured(): boolean`
  - `export async function storageObjectExists(storageKey: string): Promise<boolean>`

- [x] **Step 1: Write the failing tests** — append to `src/lib/storage.test.ts` (and extend the import line):

```ts
import {
  downloadBundledFile,
  getPresignedDownloadUrl,
  isObjectStorageConfigured,
  mapLocalPathToStorageKey,
} from "./storage";

describe("mapLocalPathToStorageKey", () => {
  it("keeps identity-mapped prefixes unchanged", () => {
    assert.equal(mapLocalPathToStorageKey("forms/DFA-TS-12_Rev_-2-24.pdf"), "forms/DFA-TS-12_Rev_-2-24.pdf");
    assert.equal(mapLocalPathToStorageKey("orientation/New Student Welcome Letter.pdf"), "orientation/New Student Welcome Letter.pdf");
    assert.equal(mapLocalPathToStorageKey("lms/Aztec/getting-started.pdf"), "lms/Aztec/getting-started.pdf");
  });

  it("applies the uploader FOLDER_MAP renames", () => {
    assert.equal(
      mapLocalPathToStorageKey("teachers/Handbook Appendix/Section 4/WVAdultEd_Sign_in_sheet_5_2023.pdf"),
      "teachers/guides/Handbook Appendix/Section 4/WVAdultEd_Sign_in_sheet_5_2023.pdf",
    );
    assert.equal(mapLocalPathToStorageKey("students/SPOKES Rubric.pdf"), "students/resources/SPOKES Rubric.pdf");
    assert.equal(mapLocalPathToStorageKey("presentation/WVAE-color-contacts.png"), "presentations/WVAE-color-contacts.png");
  });

  it("re-routes Handbook Appendix Section 16 files to lms/certifications/program-info", () => {
    assert.equal(
      mapLocalPathToStorageKey("teachers/Handbook Appendix/Section 16/IC3 Digital Literacy.pdf"),
      "lms/certifications/program-info/IC3 Digital Literacy.pdf",
    );
  });

  it("returns null for unmapped top-level folders and root-level files", () => {
    assert.equal(mapLocalPathToStorageKey("sage-context/notes.md"), null);
    assert.equal(mapLocalPathToStorageKey("_inventory.txt"), null);
  });
});

// Storage backends are selected at module load, so this only asserts the
// unconfigured case — skip when the shell actually has creds exported.
const storageCredsPresent = Boolean(
  (process.env.STORAGE_ENDPOINT && process.env.STORAGE_BUCKET) || process.env.R2_ACCOUNT_ID,
);

describe("isObjectStorageConfigured", () => {
  it("is false when no STORAGE_*/R2_* creds are loaded", { skip: storageCredsPresent }, () => {
    assert.equal(isObjectStorageConfigured(), false);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/storage.test.ts`
Expected: FAIL — `mapLocalPathToStorageKey` / `isObjectStorageConfigured` are not exported.

- [x] **Step 3: Implement in `src/lib/storage.ts`**

Add `HeadObjectCommand` to the existing `@aws-sdk/client-s3` import at line 5:

```ts
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
```

Replace the literal reverse map block (current lines 104–112) with the forward map, mapper, and a derived reverse map:

```ts
// Local docs-upload/ top-level folder → bucket key prefix. This is the single
// TS source of truth for the convention minted by scripts/upload-to-supabase.mjs
// and scripts/seed-documents.mjs, and enforced in the live DB by the manually
// applied CHECK constraint program_document_storage_key_shape on ProgramDocument.
// Folders absent here (e.g. sage-context/) have no bucket convention and must
// not be indexed.
const LOCAL_FOLDER_TO_BUCKET_PREFIX: Record<string, string> = {
  forms: "forms",
  orientation: "orientation",
  lms: "lms",
  students: "students/resources",
  teachers: "teachers/guides",
  presentation: "presentations",
};

/**
 * Map a docs-upload/-relative path (forward slashes) to its bucket storageKey.
 * Returns null for paths under unmapped top-level folders and for root-level
 * files — the uploader skips those, so no bucket object can exist for them.
 */
export function mapLocalPathToStorageKey(relativePath: string): string | null {
  const [topFolder, ...restParts] = relativePath.split("/");
  const prefix = LOCAL_FOLDER_TO_BUCKET_PREFIX[topFolder];
  if (!prefix || restParts.length === 0) return null;
  const rest = restParts.join("/");

  // Handbook appendix Section 16 = certification module descriptors → lms/
  // (same special case as the uploader/seeder scripts)
  if (topFolder === "teachers" && rest.includes("Handbook Appendix/Section 16/")) {
    return `lms/certifications/program-info/${restParts[restParts.length - 1]}`;
  }

  return `${prefix}/${rest}`;
}

// Bundled reads must reverse the renames or keys under the renamed prefixes
// never resolve locally. Derived from the forward map so they cannot drift.
const BUNDLED_KEY_PREFIX_TO_LOCAL: Record<string, string> = Object.fromEntries(
  Object.entries(LOCAL_FOLDER_TO_BUCKET_PREFIX)
    .filter(([local, bucket]) => local !== bucket)
    .map(([local, bucket]) => [`${bucket}/`, `${local}/`]),
);
```

Add the existence helpers after `deleteFile` (keeps read/write helpers grouped):

```ts
/** True when an S3-compatible backend (Supabase Storage or R2) is configured. */
export function isObjectStorageConfigured(): boolean {
  return Boolean(s3Client && BUCKET);
}

/**
 * Check whether an object exists in the configured bucket via HeadObject.
 * Throws if object storage is not configured — callers that need a
 * guarantee (e.g. Sage ingest) must fail fast rather than guess.
 */
export async function storageObjectExists(storageKey: string): Promise<boolean> {
  try {
    await getS3Client().send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: storageKey })
    );
    return true;
  } catch (error) {
    const statusCode = typeof error === "object" && error && "$metadata" in error
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : undefined;

    if (statusCode === 404) return false;
    throw error;
  }
}
```

- [x] **Step 4: Run tests to verify they pass** (the two existing `downloadBundledFile` remap tests pin the derived reverse map to the old literal behavior)

Run: `npx tsx --test src/lib/storage.test.ts`
Expected: PASS, including "resolves teachers/guides/ keys through the uploader folder map".

- [x] **Step 5: Lint and commit**

```bash
npx eslint src/lib/storage.ts src/lib/storage.test.ts
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat(storage): shared docs-upload->bucket key mapping + object existence helpers"
```

---

### Task 2: Rework the ingest loop (mapping, refusal, curation preservation)

**Files:**
- Modify: `src/lib/sage/ingest.ts` (`collectFiles` :210-224, `SyncResult` :193-199, main loop :238-403)
- Modify: `src/app/api/teacher/documents/sage-context/sync/route.ts` (:23-33)

**Interfaces:**
- Consumes (from Task 1): `mapLocalPathToStorageKey(relativePath: string): string | null`, `isObjectStorageConfigured(): boolean`, `storageObjectExists(storageKey: string): Promise<boolean>`.
- Produces (used by Task 3): `SyncResult` gains `unmapped: string[]` and `missingObjects: string[]`; `SyncOptions` unchanged in this task.

- [x] **Step 1: Update `collectFiles` to skip `_`/`.`-prefixed entries (mirror the uploader)**

```ts
async function collectFiles(dir: string, prefix: string = ""): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    // Mirror scripts/upload-to-supabase.mjs: _-prefixed and dotfiles are
    // never uploaded, so they must never be indexed either.
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }

  return files;
}
```

- [x] **Step 2: Extend `SyncResult` and add the skip-extension set**

```ts
// File types the uploader never uploads (see MIME_MAP nulls in
// scripts/upload-to-supabase.mjs) — indexing them would guarantee orphans.
const NEVER_UPLOADED_EXTENSIONS = new Set([".url", ".ai"]);

export interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  orphaned: number;
  /** Local paths with no bucket key convention (unmapped folder / root file). */
  unmapped: string[];
  /** Mapped paths refused because no object exists in the bucket for the key. */
  missingObjects: string[];
  errors: string[];
}
```

- [x] **Step 3: Rework the main loop in `syncSageDocuments`**

Add the import:

```ts
import { isObjectStorageConfigured, mapLocalPathToStorageKey, storageObjectExists } from "@/lib/storage";
```

Fail fast before any work (right after the `GEMINI_API_KEY` check):

```ts
  if (!isObjectStorageConfigured()) {
    throw new Error(
      "Object storage is not configured — Sage document sync requires STORAGE_*/R2_* credentials to verify bucket objects before indexing."
    );
  }

  try {
    await fs.access(DOCS_ROOT);
  } catch {
    throw new Error(
      "docs-upload/ tree not found — Sage document sync must run from a checkout that includes the local docs-upload directory (it is gitignored and absent on Render)."
    );
  }
```

Initialize the extended result:

```ts
  const result: SyncResult = {
    added: 0, updated: 0, skipped: 0, orphaned: 0,
    unmapped: [], missingObjects: [], errors: [],
  };
```

Replace the loop body from the `storageKey` assignment through the upsert (current lines 258–343) with:

```ts
    const relativePath = allFiles[i];

    const ext = path.extname(relativePath).toLowerCase();
    if (NEVER_UPLOADED_EXTENSIONS.has(ext)) {
      result.skipped++;
      continue;
    }

    // Bucket keys follow the uploader FOLDER_MAP convention, not raw local paths.
    const storageKey = mapLocalPathToStorageKey(relativePath);
    if (!storageKey) {
      result.unmapped.push(relativePath);
      log(`Skipped ${relativePath}: no bucket key convention for this folder`);
      continue;
    }
    seenKeys.add(storageKey);

    if (overrides.exclude.includes(relativePath)) {
      result.skipped++;
      continue;
    }

    try {
      const fullPath = path.join(DOCS_ROOT, relativePath);
      const stat = await fs.stat(fullPath);
      const fileSizeBytes = stat.size;
      const fileModifiedAt = stat.mtime;

      const existing = await prisma.programDocument.findUnique({
        where: { storageKey },
        select: { id: true, sizeBytes: true, fileModifiedAt: true, sageContextNote: true },
      });

      // Unchanged files skip regardless of isActive/usedBySage — curation
      // (including deliberate deactivation) is owned by humans, not the sync.
      if (
        existing &&
        existing.sizeBytes === fileSizeBytes &&
        existing.fileModifiedAt?.getTime() === fileModifiedAt.getTime()
      ) {
        result.skipped++;
        continue;
      }

      // Refuse to index anything without a real bucket object — a row whose
      // download 404s in prod is worse than no row (orphan set C, 2026-07-03).
      if (!(await storageObjectExists(storageKey))) {
        result.missingObjects.push(relativePath);
        log(`Refused ${relativePath}: no bucket object at ${storageKey} — upload first (scripts/upload-to-supabase.mjs)`);
        continue;
      }

      const rule = classifyFile(relativePath);
      const title = titleFromPath(relativePath);
      const mimeType = mimeFromExt(relativePath);

      const override = overrides.overrides[relativePath];

      // Note precedence: explicit override > existing (possibly teacher-edited)
      // note > generated. Regeneration only happens for rows with no note yet.
      let sageContextNote: string | null =
        override?.sageContextNote ?? existing?.sageContextNote ?? null;

      if (!sageContextNote) {
        if (rule.needsGemini && geminiUsed < geminiBudget) {
          const extraction = await extractText(fullPath);
          if (extraction?.text) {
            if (containsPII(extraction.text)) {
              log(`Skipped ${relativePath}: possible PII detected`);
              result.errors.push(`${relativePath}: possible PII detected`);
              continue;
            }
            sageContextNote = await generateSummary(extraction.text, gemini);
            geminiUsed++;
            await delay(500);
          }
        }

        if (!sageContextNote) {
          sageContextNote = buildMetadataSummary(relativePath, rule);
        }
      }

      const data = {
        title,
        storageKey,
        mimeType,
        sizeBytes: fileSizeBytes,
        fileModifiedAt,
        category: (override?.category as ProgramDocCategory) ?? rule.category,
        audience: rule.audience,
        certificationId: override?.certificationId ?? rule.certificationId ?? null,
        platformId: override?.platformId ?? rule.platformId ?? null,
        sageContextNote,
      };

      // Update never touches usedBySage/isActive — those are teacher-curated
      // via PATCH /api/teacher/documents/sage-context and must survive syncs.
      const before = existing ? "update" : "create";
      const saved = await prisma.programDocument.upsert({
        where: { storageKey },
        update: data,
        create: { ...data, usedBySage: true, isActive: true },
        select: { id: true },
      });
```

(The rest of the loop — counters, embedding block, catch, progress log — is unchanged, except the embedding block's `const ext = ...` local now reuses the `ext` computed at the top of the iteration: delete the inner re-declaration `const ext = path.extname(relativePath).toLowerCase();` inside the embedding try-block.)

The final summary log line gains the new counts:

```ts
  log(`Sync complete: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped, ${result.orphaned} orphaned, ${result.missingObjects.length} missing objects, ${result.unmapped.length} unmapped, ${result.errors.length} errors`);
```

- [x] **Step 4: Surface new fields in the sync route**

In `src/app/api/teacher/documents/sage-context/sync/route.ts`, replace the audit call (current lines 25–33):

```ts
  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "sage.knowledge_sync",
    targetType: "program_document",
    targetId: "bulk",
    summary: `Sage knowledge sync: ${result.added} added, ${result.updated} updated, ${result.orphaned} orphaned, ${result.missingObjects.length} missing objects, ${result.unmapped.length} unmapped, ${result.errors.length} errors.`,
    metadata: {
      ...result,
      errors: result.errors.slice(0, 10),
      missingObjects: result.missingObjects.slice(0, 10),
      unmapped: result.unmapped.slice(0, 10),
      missingObjectsTotal: result.missingObjects.length,
      unmappedTotal: result.unmapped.length,
    },
  });
```

- [x] **Step 5: Typecheck, lint, run storage tests (regression)**

Run: `npx tsc --noEmit && npx eslint src/lib/sage/ingest.ts src/app/api/teacher/documents/sage-context/sync/route.ts && npx tsx --test src/lib/storage.test.ts`
Expected: clean; storage tests PASS. (No unit test for `syncSageDocuments` itself: it is hard-wired to prisma + Gemini; behavioral verification happens via the Task 3 dry-run at the verification gate.)

- [x] **Step 6: Commit**

```bash
git add src/lib/sage/ingest.ts src/app/api/teacher/documents/sage-context/sync/route.ts
git commit -m "fix(sage): ingest mints bucket-convention keys, refuses rows without storage objects, preserves teacher curation"
```

---

### Task 3: Dry-run mode

**Files:**
- Modify: `src/lib/sage/ingest.ts` (`SyncOptions` :188-191, loop + orphan pass)
- Modify: `scripts/seed-sage-context.mjs`

**Interfaces:**
- Consumes: Task 2's loop structure (`existing`, `result`, `seenKeys`).
- Produces: `SyncOptions.dryRun?: boolean`; `scripts/seed-sage-context.mjs --dry-run` CLI flag.

- [x] **Step 1: Add the option and short-circuits in `ingest.ts`**

```ts
export interface SyncOptions {
  geminiBudget?: number;
  onProgress?: (msg: string) => void;
  /** Report what would change without writing to the DB, embeddings, or Gemini. */
  dryRun?: boolean;
}
```

Destructure it: `const { geminiBudget = 30, onProgress, dryRun = false } = options;`

In the loop, immediately after the `storageObjectExists` refusal check and before `classifyFile`:

```ts
      if (dryRun) {
        if (existing) result.updated++; else result.added++;
        log(`[DRY RUN] would ${existing ? "update" : "add"}: ${storageKey}`);
        continue;
      }
```

In the orphan pass, wrap the write:

```ts
  for (const doc of allSageDocKeys) {
    if (!seenKeys.has(doc.storageKey)) {
      if (dryRun) {
        log(`[DRY RUN] would unmark from Sage: ${doc.storageKey}`);
      } else {
        await prisma.programDocument.update({
          where: { storageKey: doc.storageKey },
          data: { usedBySage: false },
        });
      }
      result.orphaned++;
    }
  }

  if (!dryRun) {
    invalidatePrefix("sage:documents");
  }
```

- [x] **Step 2: Add the CLI flag to `scripts/seed-sage-context.mjs`**

```js
const DRY_RUN = process.argv.includes("--dry-run");

console.log(`Starting Sage knowledge base seed...${DRY_RUN ? " (DRY RUN — no writes)" : ""}\n`);

try {
  const result = await syncSageDocuments({
    geminiBudget: 100,
    dryRun: DRY_RUN,
    onProgress: (msg) => console.log(msg),
  });

  console.log("\n=== Seed Complete ===");
  console.log(`  Added:            ${result.added}`);
  console.log(`  Updated:          ${result.updated}`);
  console.log(`  Skipped:          ${result.skipped}`);
  console.log(`  Orphaned:         ${result.orphaned}`);
  console.log(`  Missing objects:  ${result.missingObjects.length}`);
  console.log(`  Unmapped:         ${result.unmapped.length}`);
  console.log(`  Errors:           ${result.errors.length}`);

  if (result.missingObjects.length > 0) {
    console.log("\nRefused (no bucket object — upload first):");
    result.missingObjects.forEach((p) => console.log(`  - ${p}`));
  }
  if (result.unmapped.length > 0) {
    console.log("\nUnmapped (no bucket key convention):");
    result.unmapped.forEach((p) => console.log(`  - ${p}`));
  }
  if (result.errors.length > 0) {
    console.log("\nErrors:");
    result.errors.forEach((e) => console.log(`  - ${e}`));
  }
```

(Keep the existing `process.exit(0)` / catch block.)

- [x] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/sage/ingest.ts`
Expected: clean. (`scripts/*.mjs` console usage is normal for scripts.)

- [x] **Step 4: Commit**

```bash
git add src/lib/sage/ingest.ts scripts/seed-sage-context.mjs
git commit -m "feat(sage): dry-run mode for document sync"
```

---

### Task 4: Documentation + drift guards

**Files:**
- Modify: `CLAUDE.md` (repo root — Known Issues section)
- Modify: `scripts/upload-to-supabase.mjs` (comment at FOLDER_MAP, line ~40)
- Modify: `scripts/seed-documents.mjs` (comment at FOLDER_MAP, line ~23)

- [x] **Step 1: Refresh the stale CLAUDE.md line**

Replace the Known-Issues bullet ending in "…that directory does not exist. Grounding documents live as `ProgramDocument` rows…" so the sage-context clause reads:

```markdown
- ~~docs-upload/sage-context/ is intended for RAG grounding documents~~ — Stale; that directory exists but is empty and has no bucket mapping (ingest reports it as `unmapped`). Grounding documents live as `ProgramDocument` rows in Supabase Storage, curated via the teacher documents sage-context API (`src/app/api/teacher/documents/sage-context/`) and the `catalog/` OKF (org-knowledge) layer.
```

- [x] **Step 2: Cross-reference the shared module in both scripts' FOLDER_MAP comments**

`scripts/upload-to-supabase.mjs` line 40: `// Local folder → Supabase storage prefix` becomes:

```js
// Local folder → Supabase storage prefix
// Must match LOCAL_FOLDER_TO_BUCKET_PREFIX in src/lib/storage.ts and
// FOLDER_MAP in scripts/seed-documents.mjs.
```

`scripts/seed-documents.mjs` line 23: `// ─── FOLDER → STORAGE PREFIX (must match upload-to-supabase.mjs) ────────────` becomes:

```js
// ─── FOLDER → STORAGE PREFIX (must match upload-to-supabase.mjs and ─────────
// ─── LOCAL_FOLDER_TO_BUCKET_PREFIX in src/lib/storage.ts) ───────────────────
```

- [x] **Step 3: Lint + commit**

```bash
npx eslint .
git add CLAUDE.md scripts/upload-to-supabase.mjs scripts/seed-documents.mjs
git commit -m "docs(sage): refresh sage-context note, cross-reference shared key mapping"
```

---

## Verification gate (after implementation, still BEFORE any live sync)

1. `npx eslint .` and `npx tsx --test src/lib/storage.test.ts` green; CI green on the PR.
2. From dev with `.env.local` loaded: `npx tsx scripts/seed-sage-context.mjs --dry-run`
   Expected:
   - `Unmapped: 0` (sage-context/ is empty; `_inventory.txt` is filtered by `collectFiles`).
   - `Missing objects` lists exactly the local files whose bucket objects don't exist. As of 2026-07-03 the orphan-set-C uploads have EXECUTED (8/10 done), so the expected list is ≈ the 2 MIME-blocked files (`lms/Bring Your A Game to Work/…Rap_Video.avi` + `…Rap.mp3` — bucket `Uploads` allowlist is [pdf, jpeg, png, gif, pptx]) plus any file added locally since. Anything else = investigate.
   - `Orphaned: 0` expected once mapping is correct — specifically the 2 `students/resources/*` sage rows and 24 lms / 13 forms / 11 orientation sage rows must NOT appear as would-unmark lines. Any would-unmark line = STOP and investigate before live run.
   - `Would update` count will be large (~500) because seeded rows have null `sizeBytes`/`fileModifiedAt` — this is the expected one-time metadata backfill, and it re-embeds those docs on the live run (embedding cost incurred once).
3. Report dry-run output to Britt. **Live sync is its own approval gate.** Orphan-set-C uploads already executed 2026-07-03; the remaining sequencing dependency is only the avi/mp3 MIME-allowlist decision (their rows stay orphaned either way until Britt widens the allowlist or deactivates them — the refusal correctly keeps ingest from touching them).
4. Delete `tmp-ingest-premise-check.mjs` once the plan is executed and verified.

## Flagged, explicitly OUT of scope (do not fold in)

- `program_document_storage_key_shape` CHECK constraint exists only in the live DB, not in migrations — migration-drift follow-up (see memory `project_migration_history_drift`), separate gate.
- Raw error strings (incl. Prisma messages) flow through `result.errors` to the API client — pre-existing; mapping fix removes the CHECK-violation class; broader sanitization is a separate task.
- The sync route on Render will now fail fast with a clear message instead of ENOENT, but it remains non-functional in prod by design (no docs-upload tree). If a prod-usable sync is ever wanted, that's a feature decision.
- Orphan-set-C row remediation itself (uploads/deactivations) — separate pre-approved gate (chip task_c043f60a and tmp-orphan-c-plan.json).
- `feedback.md` interplay note: with D2 (curation preservation), the 3 dupe-row deactivations from the orphan-C plan will survive future syncs without needing `config/sage-overrides.json` exclusions.
