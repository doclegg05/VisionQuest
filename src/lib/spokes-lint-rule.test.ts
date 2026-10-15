// src/lib/spokes-lint-rule.test.ts
import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/spokes-palette.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: "module" } });
const tsx = "src/components/x.tsx";

tester.run("spokes/no-off-palette-color", rule, {
  valid: [
    { code: 'const a = "bg-danger-soft text-danger border-info";', filename: tsx },
    { code: 'const c = "#004071";', filename: "src/lib/chart.ts" },
    { code: 'const t = "text-[15px] text-[13px]";', filename: tsx },
    { code: 'const href = "#top";', filename: tsx },
    { code: 'const prose = "Use the red pen on page 500";', filename: tsx },
    { code: 'const s = "shadow-[0_2px_8px_rgba(0,64,113,0.2)]";', filename: tsx },
    { code: 'const s = "rgb(255 255 255 / 0.5)";', filename: tsx },
  ],
  invalid: [
    { code: 'const a = "px-2 bg-red-50";', filename: tsx, errors: [{ messageId: "hue" }] },
    { code: "const a = `p-1 ${x} text-amber-700`;", filename: tsx, errors: [{ messageId: "hue" }] },
    { code: 'const a = "hover:border-l-sky-400";', filename: tsx, errors: [{ messageId: "hue" }] },
    { code: 'const c = "#004071";', filename: tsx, errors: [{ messageId: "hexTsx" }] },
    { code: 'const c = "#c43c3c";', filename: "src/lib/chart.ts", errors: [{ messageId: "hexTs" }] },
    { code: 'const a = "text-[0.65rem]";', filename: tsx, errors: [{ messageId: "smallText" }] },
    { code: 'const a = "text-[11px]";', filename: tsx, errors: [{ messageId: "smallText" }] },
    { code: 'const a = "text-danger-soft";', filename: tsx, errors: [{ messageId: "softText" }] },
    { code: 'const s = "shadow-[0_4px_12px_rgba(15,154,146,0.2)]";', filename: tsx, errors: [{ messageId: "rgb" }] },
    { code: 'const s = "rgba(0, 0, 0, 0.1)";', filename: "src/lib/shadow.ts", errors: [{ messageId: "rgb" }] },
  ],
});
