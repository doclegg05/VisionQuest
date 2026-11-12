/**
 * The layout and template files Next.js renders above a page, so a
 * measurement test can notice when a new one appears. Reads the file system
 * only; test support for the readiness query counts.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const LAYER_NAMES = ["layout", "template"] as const;
const LAYER_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"] as const;

/**
 * Every `layout` and `template` file from `appDir` down to `pageDir`, both
 * included, as paths relative to `root`, outermost first.
 */
export function routeLayers(root: string, appDir: string, pageDir: string): string[] {
  const relative = path.relative(appDir, pageDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${pageDir} is not inside ${appDir}.`);
  }
  const segments = relative === "" ? [] : relative.split(path.sep);
  const directories = [appDir, ...segments.map((_, index) => path.join(appDir, ...segments.slice(0, index + 1)))];
  return directories.flatMap((directory) =>
    LAYER_NAMES.flatMap((name) =>
      LAYER_EXTENSIONS.map((extension) => path.join(directory, `${name}${extension}`))
        .filter((file) => existsSync(file))
        .map((file) => path.relative(root, file).split(path.sep).join("/")),
    ),
  );
}

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs"] as const;
/** `from "x"`, `import "x"`, `import("x")` and `require("x")`. Comments match too: that only counts more. */
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
const DATABASE_FILE = "src/lib/db.ts";
const PRISMA_CLIENT = "@prisma/client";

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

/** A relative or `@/` specifier as a repo-relative source file, or null for a package. */
function resolveImport(root: string, fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(root, "src", specifier.slice(2))
    : specifier.startsWith(".") ? path.join(root, path.dirname(fromFile), specifier) : null;
  if (base === null) return null;
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  const found = candidates.find((file) => existsSync(file) && statSync(file).isFile());
  return found === undefined ? null : path.relative(root, found).split(path.sep).join("/");
}

function isPrismaClient(specifier: string): boolean {
  return specifier === PRISMA_CLIENT || specifier.startsWith(`${PRISMA_CLIENT}/`);
}

/**
 * The import path from `entry` (repo-relative) to `src/lib/db.ts` or
 * `@prisma/client`, following relative and `@/` imports, or null when none
 * reaches either. Packages other than the Prisma client are not followed.
 */
export function databaseImportChain(root: string, entry: string): string[] | null {
  const parents = new Map<string, string | null>([[entry, null]]);
  const chainTo = (file: string): string[] => {
    const parent = parents.get(file);
    return parent === null || parent === undefined ? [file] : [...chainTo(parent), file];
  };
  const queue = [entry];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (file === DATABASE_FILE) return chainTo(file);
    for (const specifier of importSpecifiers(readFileSync(path.join(root, file), "utf8"))) {
      if (isPrismaClient(specifier)) return [...chainTo(file), PRISMA_CLIENT];
      const resolved = resolveImport(root, file, specifier);
      if (resolved === null || parents.has(resolved)) continue;
      parents.set(resolved, file);
      queue.push(resolved);
    }
  }
  return null;
}
