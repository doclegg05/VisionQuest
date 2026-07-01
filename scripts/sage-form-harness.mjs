#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";
loadEnvFile();
async function main() {
  const args = parseArgs();
  const fixturePath = args.fixture ?? "config/sage-form-eval.json";
  const { cases } = JSON.parse(readFileSync(fixturePath, "utf8"));
  const { searchForms } = await import("../src/lib/spokes/form-search.ts");
  let top1 = 0, top3 = 0, cleanTop3 = 0, forbiddenHits = 0, method = null;
  const results = [];
  for (const c of cases) {
    const res = await searchForms({ query: c.query, role: c.role ?? "student", limit: 3 });
    method = res.method;
    const ids = res.candidates.map((x) => x.form.id);
    const expected = c.expectedFormIds ?? [];
    const forbidden = c.forbiddenFormIds ?? [];
    const inTop1 = expected.length > 0 && ids[0] === expected[0];
    const inTop3 = expected.some((e) => ids.includes(e));
    const clean = inTop3 && !ids.slice(0, 3).some((id) => forbidden.includes(id));
    if (inTop1) top1++;
    if (inTop3) top3++;
    if (clean) cleanTop3++;
    forbiddenHits += ids.slice(0, 3).filter((id) => forbidden.includes(id)).length;
    results.push({ id: c.id, ids, inTop1, inTop3, clean });
  }
  const report = { fixturePath, method, total: cases.length, top1, top3, cleanTop3, forbiddenHits, results };
  console.log(JSON.stringify(report, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
