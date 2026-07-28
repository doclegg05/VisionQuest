import { evaluateMigrationAcceptance } from "./adapter";

const { results, freezeStatus, capabilities } =
  evaluateMigrationAcceptance();
const passed = results.filter((result) => result.passed);

console.log("VISIONQUEST AUTHENTICATION MIGRATION ACCEPTANCE");
console.log("===============================================");
console.log("data_mode: synthetic frozen fixtures only");
console.log("network_access: none");
console.log("database_access: none");
console.log(`historical_freeze_status: ${freezeStatus.status}`);
console.log("");
console.log("MIGRATION RESULTS");
for (const result of results) {
  console.log(
    `[${result.passed ? "PASS" : "FAIL"}] ${result.id} | ${result.requirement}`,
  );
  console.log(`  expected: ${result.expected}`);
  console.log(`  actual: ${result.actual}`);
}
console.log("");
console.log("ADDITIONAL CAPABILITIES");
for (const [name, available] of Object.entries(capabilities)) {
  console.log(`  [${available ? "PASS" : "FAIL"}] ${name}`);
}
console.log("");
console.log("FROZEN PATHS");
for (const entry of freezeStatus.paths) {
  console.log(`  [${entry.verified ? "VERIFIED" : "MISMATCH"}] ${entry.path}`);
  console.log(`    sha256: ${entry.actual}`);
}
console.log("");
console.log("SUMMARY");
console.log(`  scenarios: ${results.length}`);
console.log(`  passing: ${passed.length}`);
console.log(`  failing: ${results.length - passed.length}`);
console.log(
  `AUTH MIGRATION BASELINE RESULT: ${
    freezeStatus.status === "VERIFIED" &&
    passed.length === results.length &&
    Object.values(capabilities).every(Boolean)
      ? "PASS"
      : "FAIL"
  }`,
);

if (
  freezeStatus.status !== "VERIFIED" ||
  passed.length !== results.length ||
  !Object.values(capabilities).every(Boolean)
) {
  process.exitCode = 1;
}
