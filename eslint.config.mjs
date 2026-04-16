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
