#!/usr/bin/env node
// Prints the database query count for one hot path, for the readiness scorecard.
//
//   node --import tsx --experimental-test-module-mocks scripts/readiness/query-count.mjs <path> [--cache=cold|warm] [--client=app|admin|all] [--unit=round-trips|statements|calls]
//
//   <path>   dashboard      M1, one student dashboard render
//            teacher-home   M6, one teacher home render
//            chat-send      M3, POST /api/chat/send before its first word: the
//                           larger of the round trips before the route builds
//                           its stream and before it first calls the provider
//            dashboard-idle M2, statements per minute an open, idle student
//                           dashboard costs through its polls. A rate, not a
//                           render: --cache and --unit do not apply to it,
//                           --client does
//
// The last line of stdout is the count as a bare number, printed only when
// the measurement ran clean. By default it is the cold count in estimated
// round trips to the database, as `estimateRoundTrips` in
// src/lib/query-counter.test-support.ts computes it and the test prints it:
//   4 for each app-client call (BEGIN, set_config, the query, COMMIT: see the
//     RLS wrapper in src/lib/db.ts), when both statements are already prepared
//     on that connection,
//   1 for each admin-client call, with same-tick findUnique calls of one shape
//     counted once, as Prisma's dataloader sends them,
//   1 for each nested relation a call loads, when the level above it returned
//     rows,
//   withAppTransaction as it runs: 4 around its queries, each query 1;
//   any other $transaction: 2 around its queries.
// --unit=statements counts the statements that carry a query (calls after
// batching, plus nested loads); --unit=calls counts calls only.
// Every path counts app plus admin by default (--client=all). An admin call
// still costs a round trip, so leaving it out would reward moving a read from
// `prisma` to `prismaAdmin`, which also skips row-level security.
// A cold statement adds a prepare round trip. Through a transaction pooler with
// pgbouncer=true, Prisma turns its statement cache off, so an app call is about
// 7 and a nested load about 2. Every number printed is therefore a floor on
// wire round trips: good for comparing before and after, not a latency budget.
// What else the estimate cannot see is listed in the support file's header.
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
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PATHS = {
  dashboard: { metric: "M1", test: "src/lib/readiness/dashboard-query-count.test.tsx" },
  "teacher-home": { metric: "M6", test: "src/lib/readiness/teacher-home-query-count.test.tsx" },
  "chat-send": { metric: "M3", test: "src/lib/readiness/chat-send-query-count.test.ts" },
  "dashboard-idle": { metric: "M2", test: "src/lib/readiness/dashboard-idle-query-count.test.ts", rate: true },
};
const DEFAULT_CLIENT = "all";
const CACHES = ["cold", "warm"];
const CLIENTS = ["app", "admin", "all"];
const UNITS = ["round-trips", "statements", "calls"];
const COUNT_FIELDS = [
  "app", "admin", "appNested", "adminNested", "appStatements", "adminStatements", "appRoundTrips", "adminRoundTrips", "read",
];
const COUNT_LINE = new RegExp(
  `QUERY_COUNT path=(\\S+) cache=(cold|warm) ${COUNT_FIELDS.map((field) => `${field}=(\\d+)`).join(" ")}`,
);

const RATE_LINE = /IDLE_RATE path=(\S+) windowMs=(\d+) ticks=(\d+) appPerMinute=([\d.]+) adminPerMinute=([\d.]+) perMinute=([\d.]+)/;

/** The idle rate a rate path's test printed, or null. */
export function parseRate(name, output) {
  for (const line of output.split("\n")) {
    const match = RATE_LINE.exec(line);
    if (!match || match[1] !== name) continue;
    const [windowMs, ticks, app, admin] = match.slice(2, 6).map(Number);
    return { windowMs, ticks, app, admin };
  }
  return null;
}

/** Statements per minute for the chosen client. */
export function rateTotal(rate, { client }) {
  return (client === "admin" ? 0 : rate.app) + (client === "app" ? 0 : rate.admin);
}

const BOUNDARY_LINE = /QUERY_BOUNDARY path=(\S+) cache=(cold|warm) beforeStream=(\d+) beforeProvider=(\d+)/;

/** chat-send's two first-word boundaries, by cache, in round trips. */
export function parseBoundaries(name, output) {
  const boundaries = {};
  for (const line of output.split("\n")) {
    const match = BOUNDARY_LINE.exec(line);
    if (!match || match[1] !== name) continue;
    boundaries[match[2]] = { beforeStream: Number(match[3]), beforeProvider: Number(match[4]) };
  }
  return boundaries;
}

export function describeBoundary(cache, { beforeStream, beforeProvider }) {
  return `  ${cache}: before the stream ${beforeStream}, before the provider call ${beforeProvider}; the gate reads the larger`;
}

const USAGE = [
  `Usage: query-count.mjs <${Object.keys(PATHS).join("|")}> [--cache=cold|warm] [--client=app|admin|all] [--unit=round-trips|statements|calls]`,
  "  --cache=cold (the default) or --cache=warm",
  "  --client=all (the default) counts app and admin; --client=app or --client=admin counts one",
  "  --unit=round-trips (the default), --unit=statements or --unit=calls",
  "",
  "What the round trips assume. 4 per app call (BEGIN, set_config, the query, COMMIT) is the case",
  "where both statements are already prepared on that connection; a cold statement adds a prepare",
  "round trip. When the app connects through a transaction pooler with pgbouncer=true, Prisma turns",
  "its statement cache off, so one app call is about 7 and a nested load about 2. Every number this",
  "prints is a floor on wire round trips: good for comparing before and after, not a latency budget.",
].join("\n");

function usage(problem) {
  console.error(`${problem}\n${USAGE}`);
  process.exit(2);
}

const CHOICES = { "--cache": CACHES, "--client": CLIENTS, "--unit": UNITS };
const OPTION_KEYS = { "--cache": "cache", "--client": "client", "--unit": "unit" };

export function parseArguments(argv) {
  const [name, ...flags] = argv;
  if (!name || !Object.hasOwn(PATHS, name)) usage(`Unknown path "${name ?? ""}".`);
  const options = { name, cache: "cold", client: DEFAULT_CLIENT, unit: "round-trips" };
  for (const flag of flags) {
    const [key, value] = flag.split("=");
    const choices = Object.hasOwn(CHOICES, key) ? CHOICES[key] : undefined;
    if (!choices) usage(`Unknown option "${flag}".`);
    if (value === undefined) usage(`${key} needs a value: ${choices.map((choice) => `${key}=${choice}`).join(", ").replace(/, ([^,]*)$/, " or $1")}.`);
    if (!choices.includes(value)) usage(`Unknown value in "${flag}".`);
    options[OPTION_KEYS[key]] = value;
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
    const values = match.slice(3).map(Number);
    counts[match[2]] = Object.fromEntries(COUNT_FIELDS.map((field, index) => [field, values[index]]));
  }
  return counts;
}

const UNIT_FIELDS = {
  "round-trips": { app: "appRoundTrips", admin: "adminRoundTrips" },
  statements: { app: "appStatements", admin: "adminStatements" },
  calls: { app: "app", admin: "admin" },
};

export function total(count, { client, unit }) {
  const fields = UNIT_FIELDS[unit];
  const app = client === "admin" ? 0 : count[fields.app];
  const admin = client === "app" ? 0 : count[fields.admin];
  return app + admin + count.read;
}

function reportRate(options, target, run, output) {
  const rate = parseRate(options.name, output);
  if (!rate) {
    console.error(output);
    console.error(`No idle rate was printed by ${target.test}.`);
    process.exit(2);
  }
  console.log(`${target.metric} ${options.name}: measured by running ${target.test}`);
  console.log(`  ${rate.ticks} poll moments in ${rate.windowMs / 60_000} simulated minutes; statements a minute: app ${rate.app}, admin ${rate.admin}`);
  console.log(`reporting: statements per minute, ${options.client === "all" ? "app + admin" : options.client}`);
  if (run.status !== 0) {
    console.error(`${target.test} failed: the measured rate no longer matches the pinned value, or the path broke. Run it to see which. No number is reported.`);
    process.exit(1);
  }
  console.log(String(rateTotal(rate, options)));
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const target = PATHS[options.name];
  const run = runTest(target.test);
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  if (target.rate) return reportRate(options, target, run, output);
  const counts = parseCounts(options.name, output);
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
      `  ${cache}: calls app ${count.app}, admin ${count.admin};` +
        ` nested loads app ${count.appNested}, admin ${count.adminNested};` +
        ` statements app ${count.appStatements}, admin ${count.adminStatements};` +
        ` round trips app ${count.appRoundTrips}, admin ${count.adminRoundTrips}` +
        ` (read not executed ${count.read})`,
    );
  }
  const boundaries = parseBoundaries(options.name, output);
  if (Object.keys(boundaries).length > 0) console.log("first-word boundaries, app + admin round trips:");
  for (const cache of CACHES) if (boundaries[cache]) console.log(describeBoundary(cache, boundaries[cache]));
  const clientLabel = options.client === "all" ? "app + admin" : options.client;
  console.log(`reporting: ${options.cache}, ${clientLabel}, in ${options.unit}`);
  if (run.status !== 0) {
    console.error(`${target.test} failed: the measured count no longer matches the pinned value, or the path broke. Run it to see which. No number is reported.`);
    process.exit(1);
  }
  console.log(String(total(chosen, options)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
