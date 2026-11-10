#!/usr/bin/env node
// Prints the database query count for one hot path, for the readiness scorecard.
//
//   node --import tsx --experimental-test-module-mocks scripts/readiness/query-count.mjs <path> [--cache=cold|warm] [--client=app|admin|all]
//
//   <path>   dashboard      M1, one student dashboard render
//            teacher-home   M6, one teacher home render
//            chat-send      M3, POST /api/chat/send up to stream creation
//
// The last line of stdout is the count as a bare number. By default that is
// the cold count the plan's metric names: app-client queries for dashboard and
// teacher-home, app plus admin for chat-send.
//
// How it measures: it runs the path's test file under src/lib/readiness/ in a
// child process and reads the QUERY_COUNT lines that test prints. It does not
// call mock.module itself: the measurement and its fixture live in the test,
// so the number the scorecard reads is the number the test pins.
//
// Exit codes: 0 measured and equal to the pinned value; 1 measured, but the
// test failed (the pinned value is out of date, or the path broke); 2 usage
// error or nothing measured.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PATHS = {
  dashboard: { metric: "M1", test: "src/lib/readiness/dashboard-query-count.test.tsx", client: "app" },
  "teacher-home": { metric: "M6", test: "src/lib/readiness/teacher-home-query-count.test.tsx", client: "app" },
  "chat-send": { metric: "M3", test: "src/lib/readiness/chat-send-query-count.test.ts", client: "all" },
};
const CACHES = ["cold", "warm"];
const CLIENTS = ["app", "admin", "all"];
const COUNT_LINE = /QUERY_COUNT path=(\S+) cache=(cold|warm) app=(\d+) admin=(\d+) relationLoads=(\d+) read=(\d+)/;

function usage(problem) {
  console.error(`${problem}\nUsage: query-count.mjs <${Object.keys(PATHS).join("|")}> [--cache=${CACHES.join("|")}] [--client=${CLIENTS.join("|")}]`);
  process.exit(2);
}

function parseArguments(argv) {
  const [name, ...flags] = argv;
  if (!name || !Object.hasOwn(PATHS, name)) usage(`Unknown path "${name ?? ""}".`);
  const options = { name, cache: "cold", client: PATHS[name].client };
  for (const flag of flags) {
    const [key, value] = flag.split("=");
    if (key === "--cache" && CACHES.includes(value)) options.cache = value;
    else if (key === "--client" && CLIENTS.includes(value)) options.client = value;
    else usage(`Unknown option "${flag}".`);
  }
  return options;
}

function runTest(testFile) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--experimental-test-module-mocks", "--test", "--test-reporter=tap", testFile],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

function parseCounts(name, output) {
  const counts = {};
  for (const line of output.split("\n")) {
    const match = COUNT_LINE.exec(line);
    if (!match || match[1] !== name) continue;
    const [app, admin, relationLoads, read] = match.slice(3).map(Number);
    counts[match[2]] = { app, admin, relationLoads, read };
  }
  return counts;
}

function executed(count, client) {
  if (client === "app") return count.app;
  if (client === "admin") return count.admin;
  return count.app + count.admin;
}

const options = parseArguments(process.argv.slice(2));
const target = PATHS[options.name];
const run = runTest(target.test);
const counts = parseCounts(options.name, `${run.stdout ?? ""}\n${run.stderr ?? ""}`);
const chosen = counts[options.cache];

if (!chosen) {
  console.error(run.stdout ?? "");
  console.error(run.stderr ?? "");
  console.error(`No ${options.cache} count was printed by ${target.test}.`);
  process.exit(2);
}

console.log(`${target.metric} ${options.name}: measured by running ${target.test}`);
for (const cache of CACHES) {
  const count = counts[cache];
  if (!count) continue;
  console.log(
    `  ${cache}: app ${count.app}, admin ${count.admin}, nested relation loads ${count.relationLoads}` +
      ` (executed ${count.app + count.admin}, read not executed ${count.read})`,
  );
}
const clientLabel = options.client === "all" ? "app + admin" : options.client;
console.log(`reporting: ${options.cache}, ${clientLabel}, executed ${executed(chosen, options.client)} + read ${chosen.read}`);
if (run.status !== 0) {
  console.error(`${target.test} failed: the measured count no longer matches the pinned value, or the path broke. Run it to see which.`);
}
console.log(String(executed(chosen, options.client) + chosen.read));
process.exit(run.status === 0 ? 0 : 1);
