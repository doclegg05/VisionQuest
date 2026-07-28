#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { evaluateSwitchDecision, parseCsv } from "./scoring.mjs";

function parseRunDirectory(argv) {
  const inline = argv.find((argument) => argument.startsWith("--run="));
  if (inline) return inline.slice("--run=".length);
  const index = argv.indexOf("--run");
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  throw new Error("Usage: npm run ai:benchmark:score -- --run <artifact-directory>");
}

async function main() {
  const runDirectory = resolve(parseRunDirectory(process.argv.slice(2)));
  const [scoreText, keyText, runsText] = await Promise.all([
    readFile(join(runDirectory, "blind-scoring.csv"), "utf8"),
    readFile(join(runDirectory, "blind-key.json"), "utf8"),
    readFile(join(runDirectory, "runs.jsonl"), "utf8"),
  ]);
  const scoreRows = parseCsv(scoreText);
  const blindKey = JSON.parse(keyText);
  const runs = runsText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const decision = evaluateSwitchDecision({ scoreRows, blindKey, runs });
  const outputPath = join(runDirectory, "decision.json");
  await writeFile(outputPath, `${JSON.stringify(decision, null, 2)}\n`);
  console.log(`${decision.recommendation}: ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
