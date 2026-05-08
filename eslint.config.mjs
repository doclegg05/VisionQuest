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
      ],
    },
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Sprint 2 / Bundle #7 lint rules (2026-05-08 review remediation)
  //
  // All three rules below ship at "warn" so the existing backlog
  // (~60 req.json sites, ~44 client console.* sites) does NOT turn the
  // build red on every PR. The follow-up sprint flips them to "error" once
  // Bundle #8 (Zod adoption) and the client-logger migration finish.
  // ─────────────────────────────────────────────────────────────────────────

  // Forbid console.* in client components. Server-side console.* (in src/lib/**)
  // is still allowed because it routes through proper server logging.
  // Will be flipped to "error" after the client-logger migration is complete.
  {
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/app/**/page.tsx",
      "src/app/**/layout.tsx",
    ],
    ignores: [
      "src/components/**/*.test.{ts,tsx}",
      "src/components/**/__tests__/**",
    ],
    rules: {
      "no-console": "warn",
    },
  },

  // Forbid `req.json()` inside API route handlers — bypasses Zod validation.
  // parseBody(req, schema) from @/lib/schemas is the sanctioned entry point.
  // Will be flipped to "error" after Bundle #8 (Zod adoption) is complete.
  {
    files: ["src/app/api/**/*.ts"],
    ignores: ["src/app/api/**/*.test.ts", "src/app/api/**/__tests__/**"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          // Match `req.json()` — the parameter name used everywhere in this codebase.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='json'][callee.object.name='req']",
          message:
            "Parse request bodies via parseBody(req, schema) from @/lib/schemas — direct req.json() bypasses Zod validation. See review 2026-05-08.",
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
  ]),
]);

export default eslintConfig;
