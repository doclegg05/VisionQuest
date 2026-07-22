#!/usr/bin/env node
// Conformance gate for .claude/commands/ci-pipeline.md against the approved spec:
// docs/superpowers/specs/2026-07-22-ci-pipeline-command-design.md
//
// Prints one PASS/FAIL line per acceptance check and `OVERALL: n/m`; exits 0
// only when every check passes. Static text checks only — no network, no DB.
//
// Encoding notes for authors of ci-pipeline.md:
// - Check 4 counts case-sensitive `STOP` tokens and requires exactly ONE
//   (the plan-approval gate). Failure-cap language must use lowercase
//   ("stop and report") to avoid counting as a second gate.
// - Check 8 requires the draft PR to be created BEFORE the CI watch
//   (`gh pr checks`) because CI only triggers on PRs to main.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const COMMAND_PATH = ".claude/commands/ci-pipeline.md";

function readCommandText() {
  try {
    return readFileSync(COMMAND_PATH, "utf8");
  } catch {
    return null;
  }
}

function isGitTracked(path) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", path], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

const text = readCommandText();

// Each check: [label, predicate over the command text]
const contentChecks = [
  [
    "intake: accepts $ARGUMENTS (issue number or freeform)",
    (t) => t.includes("$ARGUMENTS"),
  ],
  [
    "intake: exact issue fetch (gh issue view --json title,body,labels,url)",
    (t) => t.includes("gh issue view") && t.includes("title,body,labels,url"),
  ],
  [
    "stages: Scout, Plan, Build, Test, CI/CD, Engineer Review all present",
    (t) =>
      ["Scout", "Plan", "Build", "Test", "Engineer Review"].every((s) =>
        t.includes(s)
      ) && /CI\/CD|CI\b/.test(t),
  ],
  [
    "gate: exactly one STOP (plan approval) — no other mid-pipeline stops",
    (t) => (t.match(/\bSTOP\b/g) ?? []).length === 1,
  ],
  [
    "local gate: lint, typecheck, test, audit:api-auth, catalog --no-db, build",
    (t) =>
      [
        "npm run lint",
        "npm run typecheck",
        "npm test",
        "npm run audit:api-auth",
        "scripts/catalog/validate.mjs --no-db",
        "npm run build",
      ].every((cmd) => t.includes(cmd)),
  ],
  [
    "fail-loops: max 3 local fix loops and max 2 CI loops",
    (t) => /max(imum)?\s+(of\s+)?3/i.test(t) && /max(imum)?\s+(of\s+)?2/i.test(t),
  ],
  [
    "review pass: code-reviewer agent runs before push",
    (t) => t.includes("code-reviewer"),
  ],
  [
    "ordering: draft PR created before CI watch (gh pr checks --watch)",
    (t) => {
      const draftAt = t.search(/--draft|draft PR/i);
      const watchAt = t.indexOf("gh pr checks");
      return draftAt !== -1 && watchAt !== -1 && draftAt < watchAt && t.includes("--watch");
    },
  ],
  [
    "ci fail-loop input: gh run view --log-failed",
    (t) => t.includes("--log-failed"),
  ],
  [
    "ship: never merges, links issue via Closes #",
    (t) => /never merge/i.test(t) && t.includes("Closes #"),
  ],
];

const results = [
  ["file exists at " + COMMAND_PATH, text !== null],
  ["file is git-tracked (committed work, per delivery constraint)", isGitTracked(COMMAND_PATH)],
  ...contentChecks.map(([label, predicate]) => [
    label,
    text !== null && predicate(text),
  ]),
];

for (const [label, ok] of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

const passed = results.filter(([, ok]) => ok).length;
console.log(`OVERALL: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
