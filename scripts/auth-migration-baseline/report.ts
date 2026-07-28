import { execFileSync } from "node:child_process";
import {
  PROJECT_ROOT,
  evaluateBaseline,
  verifyFreezeManifest,
} from "./baseline";

function gitHead(): string {
  return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
  }).trim();
}

const { fixtures, source, results } = evaluateBaseline();
const freeze = verifyFreezeManifest();
const safeguards = results.filter(
  (result) => result.disposition === "BASELINE_SAFEGUARD",
);
const gaps = results.filter(
  (result) => result.disposition === "MIGRATION_GAP",
);

console.log("VISIONQUEST AUTHENTICATION MIGRATION BASELINE");
console.log("============================================");
console.log(`baseline_version: ${fixtures.baselineVersion}`);
console.log(`source_head: ${gitHead()}`);
console.log("data_mode: synthetic fixtures only");
console.log("network_access: none");
console.log("database_access: none");
console.log("production_auth_changes: none");
console.log(`freeze_status: ${freeze.status}`);
console.log("");
console.log("SOURCE CONTRACT");
console.log(JSON.stringify(source, null, 2));
console.log("");
console.log("SCENARIO RESULTS");

for (const result of results) {
  console.log(
    `[${result.disposition}] ${result.id} | ${result.requirement}`,
  );
  console.log(`  case: ${result.label}`);
  console.log(`  current: ${result.actualCurrent}`);
  console.log(`  migration_required: ${result.requiredMigration}`);
}

console.log("");
console.log("FROZEN PATHS");
for (const entry of freeze.paths) {
  console.log(
    `  [${entry.verified ? "VERIFIED" : freeze.status}] ${entry.path}`,
  );
  console.log(`    sha256: ${entry.actual}`);
}

console.log("");
console.log("SUMMARY");
console.log(`  scenarios: ${results.length}`);
console.log(`  baseline_safeguards: ${safeguards.length}`);
console.log(`  migration_gaps: ${gaps.length}`);
console.log(
  `  gap_ids: ${gaps.map((result) => result.id).join(", ")}`,
);
console.log(
  `BASELINE RESULT: ${freeze.status === "MISMATCH" ? "FAIL" : "PASS"}`,
);
console.log(
  "Interpretation: PASS means the harness reproduced the frozen current contract; MIGRATION_GAP rows are expected Goal 0 findings.",
);

if (freeze.status === "MISMATCH") {
  process.exitCode = 1;
}
