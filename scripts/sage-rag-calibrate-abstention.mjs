#!/usr/bin/env node

/**
 * Read-only calibration for the Sub-project B abstention floor
 * (SAGE_RAG_ABSTAIN_DISTANCE).
 *
 * Runs hybridSearchDocuments() with the abstention gate disabled and records
 * the closest surviving cosine distance per query for (a) legitimate fixture
 * questions and (b) off-topic expectNoContext questions. Suggests a floor set
 * BETWEEN the two distributions, biased toward NOT abstaining (false abstention
 * — dropping a doc a real query needs — is the worse error).
 *
 * Non-destructive. Reads only.
 *
 * Usage:
 *   npx tsx scripts/sage-rag-calibrate-abstention.mjs
 *   npx tsx scripts/sage-rag-calibrate-abstention.mjs --out=.planning/sage-rag/B-phase0/abstention-calibration.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir, loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";

loadEnvFile();
// Disable the abstention gate so we observe the true closest distance
// (floor 2 = the max cosine distance, so the gate can never fire here).
process.env.SAGE_RAG_ABSTAIN_DISTANCE = "2";

const args = parseArgs();
const fixturePath = args.fixture || "config/sage-rag-eval.json";
const role = args.role === "staff" ? "staff" : "student";
// Match the candidate-set size the abstention gate actually sees in production:
// getDocumentContext() calls hybridSearchDocuments(..., maxResults) with
// maxResults=3, so the gate ranks over the top-3-by-RRF-score rows. Calibrating
// at a wider limit understates the gate-visible closest distance. Keep in sync
// with getDocumentContext's maxResults (and revisit if Track B widens the fetch).
const limit = args.limit ? Number(args.limit) : 3;

function closestDistance(rows) {
  if (!rows) return null;
  const distances = rows
    .map((row) => row.bestDistance)
    .filter((distance) => distance !== null && distance !== undefined);
  return distances.length ? Math.min(...distances) : null;
}

async function measure(hybridSearchDocuments, list) {
  const out = [];
  for (const item of list) {
    const rows = await hybridSearchDocuments(item.question, role, limit);
    const closest = closestDistance(rows);
    out.push({
      id: item.id,
      question: item.question,
      returned: rows ? rows.length : null, // null = hybrid unavailable (fell back)
      closest,
      // rows present but no distance = FTS-only match; a distance floor can't gate it.
      ftsOnly: Boolean(rows && rows.length > 0 && closest === null),
    });
  }
  return out;
}

async function main() {
  const { hybridSearchDocuments } = await import("../src/lib/sage/hybrid-retrieval.ts");
  const cases = JSON.parse(readFileSync(fixturePath, "utf8"));
  const legit = cases.filter((c) => (c.expectedStorageKeys || []).length > 0);
  const offtopic = cases.filter((c) => c.expectNoContext === true);

  const legitResults = await measure(hybridSearchDocuments, legit);
  const offtopicResults = await measure(hybridSearchDocuments, offtopic);

  const legitDistances = legitResults.map((r) => r.closest).filter((d) => d !== null);
  const offtopicDistances = offtopicResults.map((r) => r.closest).filter((d) => d !== null);

  const lmax = legitDistances.length ? Math.max(...legitDistances) : null;
  const omin = offtopicDistances.length ? Math.min(...offtopicDistances) : null;

  // Off-topic cases a distance floor cannot catch without harming recall:
  //  - already empty (upstream filters abstained) — no distance,
  //  - FTS-only (no distance to gate on),
  //  - an overlap sitting at/below the hardest legit match (a near-miss that
  //    genuinely matches a real doc) — catching it would drop legit queries.
  const alreadyEmpty = offtopicResults.filter((r) => r.returned === 0).map((r) => r.id);
  const ftsOnlyUncatchable = offtopicResults.filter((r) => r.ftsOnly).map((r) => r.id);
  const overlapUncatchable = offtopicResults
    .filter((r) => r.closest !== null && lmax !== null && r.closest <= lmax)
    .map((r) => r.id);

  // Off-topic lures ABOVE the hardest legit match are separable by a distance
  // floor. Pick one between them, biased toward NOT abstaining (a higher floor
  // drops fewer legit docs — false abstention is the worse error).
  const separableOfftopic = offtopicDistances.filter((d) => lmax === null || d > lmax);
  const ominSeparable = separableOfftopic.length ? Math.min(...separableOfftopic) : null;
  const separation =
    lmax !== null && ominSeparable !== null ? Math.round((ominSeparable - lmax) * 1000) / 1000 : null;
  let suggestedFloor = null;
  if (lmax !== null && ominSeparable !== null && ominSeparable > lmax) {
    suggestedFloor = Math.round((lmax + (ominSeparable - lmax) * 0.6) * 1000) / 1000;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    fixturePath,
    role,
    stats: {
      lmaxLegit: lmax,
      ominOfftopic: omin,
      ominSeparableOfftopic: ominSeparable,
      separation,
      suggestedFloor,
      offtopicAlreadyEmpty: alreadyEmpty,
      offtopicFtsOnlyUncatchable: ftsOnlyUncatchable,
      offtopicOverlapUncatchable: overlapUncatchable,
    },
    legit: legitResults,
    offtopic: offtopicResults,
  };

  if (args.out) {
    ensureParentDir(args.out);
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }

  const fmt = (d) => (d === null ? "  none" : d.toFixed(3));
  console.log("\nAbstention floor calibration");
  console.log(`Fixture: ${fixturePath} (role ${role})`);

  console.log("\nLegit queries — closest surviving distance (want SMALL), worst first:");
  for (const r of [...legitResults].sort((a, b) => (b.closest ?? -1) - (a.closest ?? -1))) {
    console.log(`  ${fmt(r.closest)}  ${r.id}`);
  }

  console.log("\nOff-topic queries — closest surviving distance (want LARGE / none), closest first:");
  for (const r of [...offtopicResults].sort((a, b) => (a.closest ?? 99) - (b.closest ?? 99))) {
    const note =
      r.returned === 0
        ? "  [already empty — upstream filter abstained]"
        : r.ftsOnly
          ? "  [FTS-only — a distance floor cannot gate this]"
          : "";
    console.log(`  ${fmt(r.closest)}  ${r.id}${note}`);
  }

  console.log(`\nLmax (hardest legit match):        ${fmt(lmax)}`);
  console.log(`Omin (closest off-topic overall):  ${fmt(omin)}`);
  console.log(`Omin (closest SEPARABLE off-topic): ${fmt(ominSeparable)}`);
  console.log(`Separation (separable Omin - Lmax): ${separation === null ? "n/a" : separation.toFixed(3)}`);
  console.log(
    `Suggested SAGE_RAG_ABSTAIN_DISTANCE: ${
      suggestedFloor === null
        ? "NO SEPARABLE CLUSTER — keep gate conservative/off"
        : `${suggestedFloor}  (catches ${separableOfftopic.length}/${offtopicResults.length} off-topic with zero legit loss)`
    }`,
  );
  if (overlapUncatchable.length) {
    console.log(
      `\n⚠ Off-topic overlaps a distance floor cannot catch (closest <= Lmax, would drop legit): ${overlapUncatchable.join(", ")}`,
    );
  }
  if (ftsOnlyUncatchable.length) {
    console.log(`⚠ Off-topic cases a distance floor cannot catch (FTS-only): ${ftsOnlyUncatchable.join(", ")}`);
  }
  if (args.out) {
    console.log(`\nWrote JSON report: ${args.out}`);
  }
}

main().catch((error) => {
  console.error("Calibration failed:", error);
  process.exitCode = 1;
});
