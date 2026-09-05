import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A `"use client"` file may not import — or re-export — a module that
 * imports Prisma. Both `src/components` and `src/app` are walked: 27 client
 * files live under `src/app`, and the first cut of this guard walked only
 * `src/components`.
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

/**
 * Both trees. 27 `"use client"` files live under src/app — route-group pages
 * and their clients — and the first cut of this guard walked only
 * src/components, so any of them could have re-introduced the break the guard
 * exists to catch.
 */
const CLIENT_ROOTS = [join(process.cwd(), "src/components"), join(process.cwd(), "src/app")];

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
  // Phase 3 repeats the same split for the same reason. The console's
  // "Add lead" form needs the lead vocabulary and the shift names, and every
  // one of those lives in a -shared module.
  {
    specifier: "@/lib/connect/matching",
    instead: "@/lib/connect/matching-shared",
    why: "it imports prisma from @/lib/db",
  },
  {
    specifier: "@/lib/connect/leads",
    instead: "@/lib/connect/leads-shared",
    why: "it imports prisma from @/lib/db",
  },
  {
    specifier: "@/lib/connect/employers",
    instead: "@/lib/connect/employers-shared",
    why: "it imports prisma from @/lib/db",
  },
  // Phase 4. The student approval card wants the status labels and the packet
  // field labels; the employer response page's client half wants the "not now"
  // reason list. All three live in a -shared module beside the Prisma one.
  {
    specifier: "@/lib/connect/pipeline",
    instead: "@/lib/connect/pipeline-shared",
    why: "it imports prisma from @/lib/db",
  },
  {
    specifier: "@/lib/connect/packet",
    instead: "@/lib/connect/packet-shared",
    why: "it imports prisma from @/lib/db",
  },
  {
    specifier: "@/lib/connect/subsidies",
    instead: "@/lib/connect/subsidies-shared",
    why: "it reads SystemConfig, which imports prisma from @/lib/db",
  },
  {
    specifier: "@/lib/connect/flags",
    instead: "@/lib/connect/flags-shared",
    why: "it reads SystemConfig, which imports prisma from @/lib/db",
  },
  {
    specifier: "@/lib/connect/employer-link",
    instead: "@/lib/connect/employer-link-shared",
    why: "it imports prismaAdmin from @/lib/db",
  },
  {
    specifier: "@/lib/connect/employer-actions",
    instead: "@/lib/connect/employer-actions-shared",
    why: "it imports prismaAdmin from @/lib/db",
  },
  // No client half at all: these are server-only end to end. The escape hatch
  // named here is the vocabulary a component would actually have been after.
  {
    specifier: "@/lib/connect/connections",
    instead: "@/lib/connect/pipeline-shared",
    why: "it imports prisma from @/lib/db",
  },
  {
    specifier: "@/lib/connect/endorsement",
    instead: "@/lib/connect/endorsement-shared",
    why: "it resolves an AI provider, which imports prisma from @/lib/db",
  },
  // No -shared twin, and none is wanted: these two exist ONLY to read student
  // data, so a client component reaching for either is a mistake in itself
  // rather than an import of the wrong half.
  {
    specifier: "@/lib/connect/workforce-batch-query",
    instead: "@/lib/connect/workforce-batch",
    why: "it imports prisma from @/lib/db and reads consent",
  },
  {
    specifier: "@/lib/connect/classes",
    // No module to send them to: the classes belong to the server component
    // that already loads them, and should arrive as props.
    instead: null,
    why: "it imports prisma from @/lib/db",
  },
  {
    specifier: "@/lib/consent",
    instead: null,
    why: "it imports prisma from @/lib/db",
  },
  // Phase 5. The settings page renders the SMS consent copy, which lives in
  // sms-policy-shared beside the quiet-hours and cap rules; the sending half
  // imports prismaAdmin. schedule/replies/alerts have no client half at all,
  // so their escape hatch is the vocabulary a component would have been after.
  {
    specifier: "@/lib/nudges/sms-policy",
    instead: "@/lib/nudges/sms-policy-shared",
    why: "it imports prismaAdmin from @/lib/db",
  },
  {
    specifier: "@/lib/nudges/schedule",
    instead: "@/lib/nudges/schedule-shared",
    why: "it imports prismaAdmin from @/lib/db",
  },
  {
    specifier: "@/lib/nudges/replies",
    instead: "@/lib/nudges/schedule-shared",
    why: "it imports prismaAdmin from @/lib/db",
  },
  {
    specifier: "@/lib/nudges/alerts",
    instead: "@/lib/nudges/schedule-shared",
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
 * Every module specifier the file references: static imports, dynamic
 * import(), AND re-exports. `export * from "@/lib/connect/work-profile"` in a
 * client file pulls the module into the same bundle as an import does, so a
 * rule that matched only `import … from` would miss it — and re-exporting a
 * barrel is exactly how this kind of dependency creeps back.
 *
 * The `from "…"` match covers both forms (`import x from`, `export * from`,
 * `export { x } from`) because all three share that clause; it is called out
 * here so the coverage is deliberate rather than incidental, and pinned by a
 * test below.
 *
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
  for (const match of code.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

const CLIENT_FILES = CLIENT_ROOTS.flatMap((root) => collectFiles(root));

describe("client files never import or re-export a Prisma-backed module", () => {
  it("finds files to check in BOTH trees (the walker is not silently empty)", () => {
    // A guard that scans nothing passes forever. Pin that the walk works, and
    // that it reaches src/app — the tree the first cut of this guard missed.
    assert.ok(CLIENT_FILES.length > 50, `only ${CLIENT_FILES.length} files found`);
    const clientFiles = CLIENT_FILES.filter((file) => isClientFile(readFileSync(file, "utf8")));
    assert.ok(clientFiles.length > 0, 'no "use client" file was detected');
    assert.ok(
      clientFiles.some((file) => file.includes("/src/app/")),
      'no "use client" file found under src/app — the second root is not being walked',
    );
    assert.ok(
      clientFiles.some((file) => file.includes("/src/components/")),
      'no "use client" file found under src/components',
    );
  });

  it("sees a re-export, not only an import", () => {
    // `export * from "@/lib/connect/work-profile"` bundles the module exactly
    // as an import does. Exercised on synthetic source so the rule is proven
    // rather than assumed from the absence of a violation today.
    const reExport = 'export * from "@/lib/connect/work-profile";';
    const named = 'export { getWorkProfile } from "@/lib/connect/work-profile";';
    const dynamic = 'const m = await import("@/lib/connect/work-profile");';
    for (const source of [reExport, named, dynamic]) {
      assert.ok(
        importedSpecifiers(source).includes("@/lib/connect/work-profile"),
        `the specifier scanner missed: ${source}`,
      );
    }
  });

  it('only treats a leading "use client" directive as a client file', () => {
    assert.equal(isClientFile('"use client";\nimport x from "y";'), true);
    assert.equal(isClientFile('// a comment\n"use client";'), true);
    assert.equal(isClientFile('import x from "y";\n// mentions "use client" in prose'), false);
  });

  it('no "use client" file imports or re-exports a server-only module', () => {
    const violations: string[] = [];

    for (const file of CLIENT_FILES) {
      const source = readFileSync(file, "utf8");
      if (!isClientFile(source)) continue;

      const specifiers = importedSpecifiers(source);
      for (const rule of SERVER_ONLY_SPECIFIERS) {
        if (specifiers.includes(rule.specifier)) {
          violations.push(
            `${file.replace(process.cwd() + "/", "")} references "${rule.specifier}" ` +
              `(${rule.why}) — ${rule.instead ? `use "${rule.instead}" instead` : "pass the data down as props from a server component"}`,
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

  it("every shared module a rule points at really is free of Prisma", () => {
    // The rules are only worth anything if their escape hatches are clean. If
    // a -shared module ever imports @/lib/db, the guard would be sending
    // components at the same break under a different name.
    for (const rule of SERVER_ONLY_SPECIFIERS) {
      // Some rules have nowhere to send a component — the data belongs in
      // props — and those carry `instead: null`.
      if (!rule.instead) continue;
      const relative = rule.instead.replace("@/", "src/");
      const shared = readFileSync(join(process.cwd(), `${relative}.ts`), "utf8");
      assert.ok(
        !importedSpecifiers(shared).some((spec) => spec === "@/lib/db" || spec.endsWith("/db")),
        `${rule.instead} imports the Prisma client — the split has collapsed`,
      );
    }
  });

  it("the work-profile shared module it points at really is free of Prisma", () => {
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
