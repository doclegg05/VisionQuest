import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
      // Guard against hardcoded light-mode navy RGBA values that become invisible
      // in dark mode. Use theme tokens from globals.css (var(--border),
      // var(--surface-muted), var(--shadow-card), etc.). Decorative gradients on
      // always-dark surfaces may disable with a targeted eslint-disable-next-line.
      "no-restricted-syntax": [
        "error",
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
      ],
    },
  },
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
