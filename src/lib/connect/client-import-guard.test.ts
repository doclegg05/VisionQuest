import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A `"use client"` file may not import a module that imports Prisma.
 *
 * This is a structural guard for a break that `npm test` could not see. The
 * first cut of src/lib/connect/work-profile.ts exported the client-safe
 * constants, Zod schemas and pure scoring helpers alongside getWorkProfile /
 * upsertWorkProfile, which import `prisma` from "@/lib/db" at module top
 * level. WorkAvailabilitySection.tsx ("use client") imported the constants,
 * which pulled the whole module — and Prisma's runtime — into the browser
 * bundle. Every unit test passed; `next build` failed:
 *
 *   ./src/lib/connect/work-profile.ts
 *   the chunking context does not support external modules
 *   (request: node:async_hooks)
 *   [Client Component Browser] work-profile.ts <- WorkAvailabilitySection.tsx
 *
 * The split is work-profile-shared.ts (no @/lib/db) for anything a client
 * component needs, and work-profile.ts for the Prisma-backed reads and writes,
 * which re-exports the shared module so server call sites keep one import.
 * This test fails on the next component that reaches for the wrong one, in the
 * gating unit job rather than at build time.
 */

const COMPONENTS_ROOT = join(process.cwd(), "src/components");

/**
 * Server-only modules that must never appear in a client component's import
 * graph. Each entry is the exact specifier a component would write.
 *
 * Deliberately a specific list rather than "anything under src/lib": most of
 * src/lib IS client-safe, and a rule that cried wolf would be turned off.
 */
const SERVER_ONLY_SPECIFIERS = [
  {
    specifier: "@/lib/connect/work-profile",
    instead: "@/lib/connect/work-profile-shared",
    why: "it imports prisma from @/lib/db",
  },
];

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFiles(full, out);
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

function isClientFile(source: string): boolean {
  // The directive has to be the first statement; a mention inside prose or a
  // string elsewhere in the file does not make a module a client module.
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(source);
}

/**
 * Import specifiers, from static imports/exports and dynamic import() alike.
 * Comments are stripped first so a doc block naming the banned module (this
 * file's own subject matter) cannot trip the rule.
 */
function importedSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
  const specifiers: string[] = [];
  for (const match of code.matchAll(/\bfrom\s+["']([^"']+)["']/g)) specifiers.push(match[1]);
  for (const match of code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

const COMPONENT_FILES = collectFiles(COMPONENTS_ROOT);

describe("client components never import a Prisma-backed module", () => {
  it("finds component files to check (the walker itself is not silently empty)", () => {
    // A guard that scans nothing passes forever. Pin that the walk works.
    assert.ok(COMPONENT_FILES.length > 50, `only ${COMPONENT_FILES.length} component files found`);
    assert.ok(
      COMPONENT_FILES.some((file) => isClientFile(readFileSync(file, "utf8"))),
      'no "use client" file was detected — the directive matcher is broken',
    );
  });

  it('no "use client" file imports a server-only module', () => {
    const violations: string[] = [];

    for (const file of COMPONENT_FILES) {
      const source = readFileSync(file, "utf8");
      if (!isClientFile(source)) continue;

      const specifiers = importedSpecifiers(source);
      for (const rule of SERVER_ONLY_SPECIFIERS) {
        if (specifiers.includes(rule.specifier)) {
          violations.push(
            `${file.replace(process.cwd() + "/", "")} imports "${rule.specifier}" ` +
              `(${rule.why}) — import "${rule.instead}" instead`,
          );
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `client components pulling a Prisma-backed module into the browser bundle:\n${violations.join("\n")}`,
    );
  });

  it("the shared module it points at really is free of Prisma", () => {
    // The rule is only worth anything if its escape hatch is clean. If
    // work-profile-shared ever imports @/lib/db, the guard would be sending
    // components at the same break under a different name.
    const shared = readFileSync(
      join(process.cwd(), "src/lib/connect/work-profile-shared.ts"),
      "utf8",
    );
    assert.ok(
      !importedSpecifiers(shared).some((s) => s === "@/lib/db" || s.endsWith("/db")),
      "work-profile-shared.ts imports the Prisma client — the split has collapsed",
    );
  });

  it("the server module still re-exports the shared one, so server imports keep working", () => {
    const server = readFileSync(join(process.cwd(), "src/lib/connect/work-profile.ts"), "utf8");
    assert.match(
      server,
      /export \* from "\.\/work-profile-shared"/,
      "work-profile.ts must re-export work-profile-shared so existing server call sites are unaffected",
    );
  });
});
