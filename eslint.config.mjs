import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Selectors that apply to every linted file. ESLint flat config replaces a
// rule's options wholesale when a later block sets the same rule, so any
// files-scoped block that adds a selector must spread these too, or it would
// silently drop them for the files it matches.
const restrictedSyntaxEverywhere = [
  // Guard against hardcoded light-mode navy RGBA values that become invisible
  // in dark mode. Use theme tokens from globals.css (var(--border),
  // var(--surface-muted), var(--shadow-card), etc.). Decorative gradients on
  // always-dark surfaces may disable with a targeted eslint-disable-next-line.
  {
    selector: "Literal[value=/rgba\\(\\s*(?:18\\s*,\\s*38\\s*,\\s*63|16\\s*,\\s*37\\s*,\\s*62)\\s*,/]",
    message:
      "Hardcoded navy rgba() is not dark-mode safe. Use theme tokens (var(--border), var(--surface-muted), var(--shadow-card), etc.) from globals.css.",
  },
  {
    selector: "TemplateElement[value.raw=/rgba\\(\\s*(?:18\\s*,\\s*38\\s*,\\s*63|16\\s*,\\s*37\\s*,\\s*62)\\s*,/]",
    message:
      "Hardcoded navy rgba() is not dark-mode safe. Use theme tokens from globals.css.",
  },
  // Students are TANF/SNAP recipients; server logs carry no student
  // identifier at any level (.claude/rules/security.md, Data Privacy).
  // Log studentLogKey(id) from src/lib/log-keys.ts when a failure needs to
  // be correlated, and redactContactInfo() for provider error text.
  {
    selector:
      "CallExpression[callee.object.name='logger'] Property[key.name=/^(studentId|targetStudentId|userId|studentEmail|phoneNumber)$/]",
    message:
      "No student identifier in server logs. Use studentLogKey(studentId) from @/lib/log-keys for a correlation key, or drop the field.",
  },
  {
    selector:
      "CallExpression[callee.object.name='logger'] Property[shorthand=false][value.name=/^(studentId|targetStudentId)$/]",
    message:
      "No student identifier in server logs, even under a different key. Use studentLogKey(studentId) from @/lib/log-keys.",
  },
];

// StudentAlert is the staff intervention queue, and the RLS policy admits a
// student's own rows, including the wellbeing crisis card (review finding F3,
// 2026-09-01). Student-facing code reads it only through
// src/lib/student-alerts.ts, which owns the type allowlist. Any object is
// matched, so an aliased client is caught as well as `prisma`. The relation
// form (select: { alerts: ... }) is deliberately not restricted: a key-name
// selector would false-positive on unrelated `alerts` properties.
const studentAlertDirectRead = {
  selector: "MemberExpression[property.name='studentAlert']",
  message:
    "Student-facing code must not read StudentAlert directly; the table is the staff queue and RLS admits the student's own rows. Use listStudentVisibleAlerts / countStudentVisibleAlerts from src/lib/student-alerts.ts, the only sanctioned reader for student surfaces.",
};

// Code with no request session: pg_cron reaches these routes with only a
// bearer secret, and job handlers run from the processor. Nothing seeds an
// RLS context, so the app client fails closed under vq_app (reads empty,
// writes rejected) and a per-student catch turns that into a silent "0 of
// N" (review F5/F62, 2026-09-01). Cross-student rows go through prismaAdmin;
// per-student lib helpers run inside withStudentRlsContext
// (src/lib/rls-context.ts). This catches the direct import only; a lib
// module that imports the app client is caught when a test exercises the
// path under RLS_CONTEXT_STRICT=true (CI).
const appPrismaImportWithoutSession = {
  files: ["src/app/api/internal/**", "src/app/api/cron/**", "src/lib/jobs-registry.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            regex: "(^|/)db$",
            importNames: ["prisma"],
            message:
              "No request session here, so the app prisma client has no RLS context and fails closed under vq_app. Import prismaAdmin for cross-student rows, and run per-student lib helpers inside withStudentRlsContext from @/lib/rls-context.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-restricted-syntax": ["error", ...restrictedSyntaxEverywhere],
    },
  },
  // Student-facing surfaces. Staff-only trees are excluded by name; the
  // staff readers (src/lib/teacher/**, src/lib/advising*.ts, src/lib/sage/**,
  // src/lib/reporting.ts, src/lib/inactivity.ts, src/lib/placement-bridge.ts)
  // sit outside these globs.
  {
    files: [
      "src/app/(student)/**",
      "src/components/**",
      "src/lib/progression/**",
      "src/app/api/**",
    ],
    ignores: [
      "src/components/teacher/**",
      "src/app/api/teacher/**",
      "src/app/api/internal/**",
      "src/app/api/cron/**",
      "src/app/api/admin/**",
      "src/app/api/coordinator/**",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSyntaxEverywhere, studentAlertDirectRead],
    },
  },
  appPrismaImportWithoutSession,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees (harness-managed checkouts) — repo-wide lint must not
    // walk them; they appear and vanish mid-run.
    ".claude/**",
  ]),
]);

export default eslintConfig;
