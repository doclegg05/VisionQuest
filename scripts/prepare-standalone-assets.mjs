// Runs via tsx (see package.json "build") so it can import the TS form
// catalog. STANDALONE_DIR is a test hook used by forms-delivery.test.ts to
// stage into a scratch directory; production builds leave it unset.
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

// Dynamic imports: a static `.ts` import from an .mjs entry gets claimed by
// Node's native type-stripping (which misreads the exports in this
// no-"type" package); the tsx loader handles dynamic imports correctly.
const { FORMS } = await import(new URL("../src/lib/spokes/forms.ts", import.meta.url));
const { bundledCandidatePaths } = await import(new URL("../src/lib/storage.ts", import.meta.url));

const root = process.cwd();
const standaloneDir = process.env.STANDALONE_DIR || join(root, ".next", "standalone");

if (!existsSync(standaloneDir)) {
  process.exit(0);
}

const copies = [
  {
    from: join(root, ".next", "static"),
    to: join(standaloneDir, ".next", "static"),
  },
  {
    from: join(root, "public"),
    to: join(standaloneDir, "public"),
  },
  // config/ holds generated runtime files (e.g. form-routing.generated.json, sage-overrides.json).
  // Copy if present so they are available to the standalone server.
  {
    from: join(root, "config"),
    to: join(standaloneDir, "config"),
  },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    continue;
  }

  rmSync(to, { recursive: true, force: true });
  mkdirSync(join(to, ".."), { recursive: true });
  cpSync(from, to, { recursive: true });
}

// Stage the bundled PDF for every FORMS[] entry with a storageKey so the
// downloadBundledFile() fallback in src/lib/storage.ts can serve forms when
// the bucket object is missing. outputFileTracingExcludes deliberately strips
// docs-upload/** from the NFT (bundle-bloat, see next.config.ts) — this
// explicit copy is the sanctioned path into the standalone server.
const staged = new Set();
const missing = [];
for (const form of FORMS) {
  if (!form.storageKey) continue;

  const candidate = bundledCandidatePaths(form.storageKey).find((relativePath) =>
    existsSync(join(root, "docs-upload", relativePath)),
  );
  if (!candidate) {
    missing.push(form.storageKey);
    continue;
  }
  if (staged.has(candidate)) continue;

  const destination = join(standaloneDir, "docs-upload", candidate);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(root, "docs-upload", candidate), destination);
  staged.add(candidate);
}

console.log(`prepare-standalone-assets: staged ${staged.size} bundled form PDFs`);
if (missing.length > 0) {
  // Loud but non-fatal: the build should not brick on a missing template, and
  // test:forms:delivery fails CI whenever a FORMS storageKey has no tracked
  // bundled source — that gate, not this warning, is the enforcement.
  console.warn(
    `prepare-standalone-assets: NO bundled source for ${missing.length} storageKey(s):`,
  );
  for (const storageKey of missing) {
    console.warn(`  - ${storageKey}`);
  }
}
