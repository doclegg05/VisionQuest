import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// This mutates source only in an ephemeral CI checkout backed by local Postgres.
if (process.env.CI !== "true") throw new Error("Gate proof runs only in CI.");
for (const name of ["DATABASE_URL", "DIRECT_URL", "ADMIN_DATABASE_URL"]) {
  const url = new URL(process.env[name]);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) || url.search || url.pathname !== "/visionquest_e2e") {
    throw new Error("Gate proof requires the hermetic E2E database.");
  }
}
const layout = "src/app/(student)/layout.tsx";
const mutations = [
  { path: "src/lib/password-change-gate.ts", from: "account.mustChangePassword === true", to: "false && account.mustChangePassword === true", gate: "/change-password", next: ["/sage-notice"] },
  // Remove enforcement, keeping the surrounding session narrowing valid.
  // A literal false && guard makes TypeScript treat its RHS as unreachable.
  { path: layout, from: "redirect(SAGE_NOTICE_ACK_PATH);", to: "void SAGE_NOTICE_ACK_PATH;", gate: "/sage-notice", next: ["/recovery-setup"] },
  // Continue replaces /dashboard and refreshes. A refresh of the old password
  // route can also redirect to /settings once its password flag is cleared.
  // Both are protected by this layout; neither may bypass recovery normally.
  { path: layout, from: 'redirect("/recovery-setup");', to: "void 0;", gate: "/recovery-setup", next: ["/dashboard", "/settings"] },
];
const originals = new Map(mutations.map(({ path }) => [path, readFileSync(path, "utf8")]));
const output = "reports/first-day-gate-proof";
mkdirSync(output, { recursive: true });
const restore = () => { for (const [path, source] of originals) writeFileSync(path, source); };
const build = () => execFileSync("npm", ["run", "build"], { stdio: "inherit", timeout: 300_000 });
const run = (name) => {
  const report = join(process.cwd(), output, `${name}.json`);
  const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "e2e/first-day-journey.spec.ts", "--reporter=json", "--retries=0"], {
    stdio: "inherit", timeout: 300_000, env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: report },
  });
  return { code: result.status, report: JSON.parse(readFileSync(report, "utf8")) };
};
const evidence = [];
try {
  build();
  if (run("baseline").code !== 0) throw new Error("Baseline first-day journey must pass before mutation proof.");
  for (const [index, mutation] of mutations.entries()) {
    restore();
    const source = originals.get(mutation.path);
    if (source.split(mutation.from).length !== 2) throw new Error("Gate source changed; update the mutation explicitly.");
    writeFileSync(mutation.path, source.replace(mutation.from, mutation.to));
    build();
    const result = run(`missing-gate-${index}`);
    const report = JSON.stringify(result.report);
    const actualPath = mutation.next.find((next) => report.includes(`"message":${JSON.stringify(`Error: FIRST_DAY_GATE_MISSING:${mutation.gate}:ACTUAL:${next}`)}`));
    if (result.code !== 1 || result.report.stats.unexpected !== 1 || !actualPath) {
      throw new Error(`Missing ${mutation.gate} did not fail for its expected redirect. Inspect the report.`);
    }
    evidence.push({ gate: mutation.gate, detected: true, actualPath });
  }
  writeFileSync(join(output, "proof.json"), JSON.stringify({ head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseline: "passed", mutations: evidence }, null, 2));
  console.log("All three missing first-day gates were detected by the browser test.");
} finally {
  restore();
}
