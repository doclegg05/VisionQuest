// THROWAWAY DIAGNOSTIC — Phase 0 corpus text audit (read-only, fully local).
// Extracts text with unpdf from the bundled local copies of the target
// teacher/admin/policy PDFs (docs-upload/teachers/...) to answer:
//   (a) does an instructor-leave/time-off/personnel policy actually exist in
//       the corpus text?
//   (b) which docs are image-only (no extractable text -> would need OCR)?
//
// Local-only: reads docs-upload/ from disk, no network, no creds, no writes.
//   node scripts/_phase0-corpus-audit.mjs
// Delete after Phase 0 is approved. Not intended to be committed.

import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

const BASE = "docs-upload/teachers";

// [title, local path relative to repo root]
const TARGETS = [
  ["SPOKES Administrative Guide", `${BASE}/Administrative_Guide_Revised_10.4.2024.pdf`],
  ["Handbook Section 1 — Acronyms & Definitions", `${BASE}/WV Adult Ed Handbook/Section_1_2025.2026.pdf`],
  ["Handbook Section 2 — Professional Development", `${BASE}/WV Adult Ed Handbook/Section_2_2025.2026.pdf`],
  ["Handbook Section 3 — Learning Disabilities", `${BASE}/WV Adult Ed Handbook/Section_3_2025.2026.pdf`],
  ["Handbook Section 4 — Student Intake & Orientation", `${BASE}/WV Adult Ed Handbook/Section_4_2025.2026.pdf`],
  ["Handbook Section 5 — Barrier Reduction", `${BASE}/WV Adult Ed Handbook/Section_5_2025.2026.pdf`],
  ["Handbook Section 6 — Assessment (TABE/CASAS)", `${BASE}/WV Adult Ed Handbook/Section_6_2025.2026.pdf`],
  ["Handbook Section 7 — Career Pathways & Certificates", `${BASE}/WV Adult Ed Handbook/Section_7_2025.2026.pdf`],
  ["Handbook Section 8 — Curriculum Standards (CCR)", `${BASE}/WV Adult Ed Handbook/Section_8_2025.2026.pdf`],
  ["Handbook Section 9 — Instructional Strategies", `${BASE}/WV Adult Ed Handbook/Section_9_2025.2026.pdf`],
  ["Handbook Section 10 — Marketing & Outreach", `${BASE}/WV Adult Ed Handbook/Section_10_2025.2026.pdf`],
  ["Handbook Section 11 — Data & Monitoring (NRS)", `${BASE}/WV Adult Ed Handbook/Section_11_2025.2026_2.pdf`],
  ["Handbook Section 12 — HSE Diplomas", `${BASE}/WV Adult Ed Handbook/Section_12_2025.2026.pdf`],
  ["Handbook Section 13 — Proxy Hours & Distance Education", `${BASE}/WV Adult Ed Handbook/Section_13_2025.2026_updated_2.18.26.pdf`],
  ["Handbook Section 14 — ESOL", `${BASE}/WV Adult Ed Handbook/Section_14_2025.2026.pdf`],
  ["Handbook Section 15 — Corrections Education", `${BASE}/WV Adult Ed Handbook/Section_15_2025_2026.pdf`],
  ["Handbook Section 16 — SPOKES Modules", `${BASE}/WV Adult Ed Handbook/Section_16_2025.2026.pdf`],
  ["WVAdultED Employee AUP", `${BASE}/WVAdultED_Employee_AUP (1).pdf`],
  ["WVAdultEd Personnel Confidentiality Agreement", `${BASE}/WVAdultEd_Personnel_Confidentiality_Agreement.pdf`],
];

const KEYWORDS = [
  "leave", "without cause", "time off", "day off", "days off", "absence",
  "absent", "personnel", "vacation", "sick", "pto", "tardy", "resignation",
  "discipline", "grievance", "suspension", "termination", "holiday",
  "bereavement", "fmla", "supervisor approval",
];
const STRONG = new Set([
  "leave", "without cause", "time off", "day off", "days off", "personnel",
  "vacation", "pto", "bereavement", "fmla", "absence",
]);

function countMatches(text, kw) {
  const re = new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
  const m = text.match(re);
  return m ? m.length : 0;
}

const imageOnly = [];
const withPolicyHits = [];
const failed = [];

for (const [title, path] of TARGETS) {
  try {
    const buf = await readFile(path);
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const clean = (text || "").replace(/\s+/g, " ").trim();
    const lower = clean.toLowerCase();
    const hits = KEYWORDS.map((k) => [k, countMatches(lower, k)]).filter(([, n]) => n > 0);
    const strongHits = hits.filter(([k]) => STRONG.has(k));
    const isImage = clean.length < 100;
    if (isImage) imageOnly.push(title);
    if (strongHits.length) withPolicyHits.push(title);

    console.log(`${isImage ? "🖼  IMAGE-ONLY?" : "📄"} ${title}`);
    console.log(`   pages=${totalPages}  chars=${clean.length}  bytes=${buf.length}`);
    console.log(`   keyword hits: ${hits.length ? hits.map(([k, n]) => `${k}(${n})`).join(", ") : "(none)"}`);
    for (const [k] of strongHits) {
      const idx = lower.indexOf(k);
      const snip = clean.slice(Math.max(0, idx - 70), idx + 90).replace(/\s+/g, " ");
      console.log(`     · "${k}": …${snip}…`);
    }
  } catch (e) {
    failed.push([title, `${e.name}: ${e.message}`]);
    console.log(`❌ ${title} — FAILED: ${e.name}: ${e.message}`);
  }
  console.log("");
}

console.log("================ SUMMARY ================");
console.log(`Targets:                 ${TARGETS.length}`);
console.log(`Extracted OK:            ${TARGETS.length - failed.length}`);
console.log(`Image-only (need OCR):   ${imageOnly.length}${imageOnly.length ? " -> " + imageOnly.join("; ") : ""}`);
console.log(`Leave/personnel signal:  ${withPolicyHits.length}${withPolicyHits.length ? " -> " + withPolicyHits.join("; ") : ""}`);
console.log(`Failed:                  ${failed.length}${failed.length ? " -> " + failed.map(([t, e]) => `${t} (${e})`).join("; ") : ""}`);
