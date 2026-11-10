#!/usr/bin/env node
// Prints the database query count for one hot path, for the readiness scorecard.
//
//   node --import tsx --experimental-test-module-mocks scripts/readiness/query-count.mjs <path> [--cache=cold|warm] [--client=app|admin|all] [--unit=round-trips|statements|calls]
//
//   <path>   dashboard      M1, one student dashboard render
//            teacher-home   M6, one teacher home render
//            chat-send      M3, POST /api/chat/send up to stream creation
//
// The last line of stdout is the count as a bare number, printed only when
// the measurement ran clean. By default it is the cold count in estimated
// round trips to the database:
//   4 for each app-client call (BEGIN, set_config, the query, COMMIT: see the
//     RLS wrapper in src/lib/db.ts),
//   1 for each admin-client call,
//   1 for each nested relation a call loads (one more SELECT in the same
//     transaction).
// So turning three calls into one call with two includes reads 12 to 6, as it
// does on the wire. --unit=statements counts calls plus nested loads with no
// weights; --unit=calls counts calls only. Dashboard and teacher-home count
// the app client; chat-send counts app plus admin.
//
// Known limits, from the 2026-11-10 database review: the nested figure is
// derived from each call's select and include, even when the parent returns
// nothing; two reads inside one interactive transaction are weighted as two
// wrapped calls; same-tick findUnique calls on the admin client are counted
// one each although Prisma batches them; and the chat-send fixture is not yet
// a normal turn. Task T4 in the readiness plan closes these.
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
const UNITS = ["round-trips", "statements", "calls"];
const APP_CALL_ROUND_TRIPS = 4;
const COUNT_LINE = /QUERY_COUNT path=(\S+) cache=(cold|warm) app=(\d+) admin=(\d+) relationLoads=(\d+) read=(\d+)/;

function usage(problem) {
  console.error(`${problem}\nUsage: query-count.mjs <${Object.keys(PATHS).join("|")}> [--cache=${CACHES.join("|")}] [--client=${CLIENTS.join("|")}] [--unit=${UNITS.join("|")}]`);
  process.exit(2);
}

function parseArguments(argv) {
  const [name, ...flags] = argv;
  if (!name || !Object.hasOwn(PATHS, name)) usage(`Unknown path "${name ?? ""}".`);
  const options = { name, cache: "cold", client: PATHS[name].client, unit: "round-trips" };
  for (const flag of flags) {
    const [key, value] = flag.split("=");
    if (key === "--cache" && CACHES.includes(value)) options.cache = value;
    else if (key === "--client" && CLIENTS.includes(value)) options.client = value;
    else if (key === "--unit" && UNITS.includes(value)) options.unit = value;
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

function total(count, { client, unit }) {
  const app = client === "admin" ? 0 : count.app;
  const admin = client === "app" ? 0 : count.admin;
  const nested = unit === "calls" ? 0 : count.relationLoads;
  const appWeight = unit === "round-trips" ? APP_CALL_ROUND_TRIPS : 1;
  return app * appWeight + admin + nested + count.read;
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
console.log(`reporting: ${options.cache}, ${clientLabel}, in ${options.unit}`);
if (run.status !== 0) {
  console.error(`${target.test} failed: the measured count no longer matches the pinned value, or the path broke. Run it to see which. No number is reported.`);
  process.exit(1);
}
console.log(String(total(chosen, options)));
