import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

// A page must be visible in the HTML the server sends, before any script runs.
// framer-motion renders `initial` on the server, so a wrapper with
// `initial={{ opacity: 0 }}` ships every student page, loading skeletons
// included, as `style="opacity:0"` until the layout scripts hydrate. Students
// on slow phones saw a blank main area. Two guards:
//   1. a render test of the real student layout (nothing about the wrapper is
//      mocked), and
//   2. a SOURCE SCAN of every layout under src/app, which also covers the
//      other role layouts without rendering each one.

mock.module("@/lib/auth", {
  exports: {
    getSession: async () => ({ id: "stu-1", studentId: "student1", displayName: "Test Student", role: "student" }),
  },
});
mock.module("next/navigation", {
  exports: {
    redirect: (to: string) => {
      throw new Error(`unexpected redirect to ${to}`);
    },
    usePathname: () => "/dashboard",
  },
});
const prismaMock = {
  goal: { count: async () => 0 },
  progression: { findUnique: async () => null },
  orientationProgress: { count: async () => 0 },
  securityQuestionAnswer: { findMany: async () => [{ questionKey: "stub" }] },
  // An acknowledged notice, so the Sage notice gate lets the page render.
  consentRecord: { findFirst: async () => ({ id: "ack" }) },
};
mock.module("@/lib/db", {
  exports: {
    prisma: prismaMock,
    // The layout's nav facts are read in one transaction (getStudentShell).
    withAppTransaction: async <T,>(work: (tx: typeof prismaMock) => Promise<T>) => work(prismaMock),
    withAppReadTransaction: async <T,>(work: (tx: typeof prismaMock) => Promise<T>) => work(prismaMock),
  },
});
mock.module("@/lib/security-questions", {
  exports: { needsRecoverySetup: () => false, hasConfiguredSecurityQuestionSet: () => true, SECURITY_QUESTIONS: [] },
});
// The chrome is not under test; the wrapper around the page is.
mock.module("@/components/ui/NavBar", { exports: { default: () => null } });
mock.module("@/components/ui/NotificationProvider", {
  exports: { default: ({ children }: { children: unknown }) => children },
});
mock.module("@/components/progression/ProgressionProvider", {
  exports: { default: ({ children }: { children: unknown }) => children },
});

const PAGE_MARKER = "page-content-marker";
const HIDDEN_FROM_JS = /(?:initial|style)\s*=\s*\{\{[^}]*\bopacity\s*:\s*["']?0["']?\s*[,}]/;
const INLINE_HIDDEN = /opacity\s*:\s*0(?![.\d])/;

let Layout: typeof import("./layout").default;

before(async () => {
  Layout = (await import("./layout")).default;
});

function layoutFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return layoutFiles(path);
    return name === "layout.tsx" ? [path] : [];
  });
}

describe("student layout HTML", () => {
  it("does not hide the page behind opacity:0 before JavaScript runs", async () => {
    const tree = await Layout({ children: <p>{PAGE_MARKER}</p> });
    const html = renderToString(tree);

    assert.ok(html.includes(PAGE_MARKER), "the page content is in the server HTML");
    assert.doesNotMatch(html, INLINE_HIDDEN, "no element in the server HTML starts at opacity:0");
  });
});

describe("layouts under src/app (source scan, not a render)", () => {
  const files = layoutFiles(join(process.cwd(), "src/app"));

  it("finds the layouts it is meant to scan", () => {
    assert.ok(files.length >= 5, `expected at least 5 layouts, found ${files.length}`);
  });

  it("no layout renders a wrapper that starts at opacity: 0 from JavaScript", () => {
    const offenders = files.filter((file) => HIDDEN_FROM_JS.test(readFileSync(file, "utf8")));

    assert.deepEqual(offenders, []);
  });

  it("no layout imports PageTransition or framer-motion directly", () => {
    const offenders = files.filter((file) => /PageTransition|framer-motion/.test(readFileSync(file, "utf8")));

    assert.deepEqual(offenders, []);
  });
});
