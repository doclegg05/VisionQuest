#!/usr/bin/env node
// Conformance gate for .claude/commands/a11y-pipeline.md against the approved
// spec: docs/superpowers/specs/2026-07-22-a11y-pipeline-command-design.md
//
// Sibling of scripts/validate-ci-pipeline-command.mjs (kept standalone so the
// CI-enforced ci-pipeline grader is never touched by sibling work). Prints one
// PASS/FAIL line per acceptance check and `OVERALL: n/m`; exits 0 only when
// every check passes. Static text checks only — no network, no DB.
//
// Encoding notes for authors of a11y-pipeline.md:
// - The STOP check counts case-sensitive `STOP` tokens and requires exactly
//   ONE (the plan-approval gate). Failure-cap language must use lowercase
//   ("stop and report").
// - The draft PR must be created BEFORE the CI watch (`gh pr checks`) because
//   CI only triggers on PRs to main.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const COMMAND_PATH = ".claude/commands/a11y-pipeline.md";

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
    "local gate: six CI-equivalent checks plus the a11y suite",
    (t) =>
      [
        "npm run lint",
        "npm run typecheck",
        "npm test",
        "npm run audit:api-auth",
        "scripts/catalog/validate.mjs --no-db",
        "npm run build",
        "npm run test:a11y",
      ].every((cmd) => t.includes(cmd)),
  ],
  [
    "a11y posture: violations fixed in the page, rules never filtered",
    (t) => /never (?:by )?filter/i.test(t),
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
  [
    "agents: named reusable agents referenced by path (scout, builder, gate-runner)",
    (t) =>
      [
        ".claude/agents/scout.md",
        ".claude/agents/builder.md",
        ".claude/agents/gate-runner.md",
      ].every((path) => t.includes(path)),
  ],
];

const results = [
  ["file exists at " + COMMAND_PATH, text !== null],
  ["file is git-tracked", isGitTracked(COMMAND_PATH)],
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
