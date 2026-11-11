#!/usr/bin/env node
/**
 * Seed one gate file per task in the deployment readiness plan.
 *
 *   node scripts/readiness/seed-gates.mjs
 *
 * Reads every task table in docs/plans/2026-11-10-deployment-readiness.md and
 * writes config/readiness/gates/<ID>.json, with a `pending` check, for each
 * task that has no file yet. It never overwrites a file: a builder edits a
 * gate's check by hand when the task lands, and a second run must not undo
 * that. Run it again when the plan gains a task.
 *
 * Metric and owner gates are written by hand. They need numbers, commands and
 * checklist rows that the plan's tables do not hold.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { tableRows } from "./parse.mjs";

const PLAN = "docs/plans/2026-11-10-deployment-readiness.md";
const GATES_DIR = "config/readiness/gates";
const TASK_COLUMNS = ["ID", "Set", "Task", "Done when"];

/**
 * Every row of every plan table that has ID, Set, Task and Done when columns.
 * The set is the first word of the Set cell ("Pilot, needs R8" is pilot). The
 * title is the Task cell up to its first full stop or colon.
 */
export function readPlanTasks(planText) {
  return tableRows(planText)
    .filter(({ header }) => TASK_COLUMNS.every((name) => header.includes(name)))
    .map(({ header, cells }) => {
      const cell = (name) => cells[header.indexOf(name)];
      return {
        id: cell("ID"),
        set: cell("Set").split(/[ ,]/)[0].toLowerCase(),
        title: cell("Task").split(/[.:] /)[0].replace(/\.$/, ""),
        doneWhen: cell("Done when"),
      };
    });
}

function main(root) {
  const dir = join(root, GATES_DIR);
  const tasks = readPlanTasks(readFileSync(join(root, PLAN), "utf8"));
  const missing = tasks.filter((task) => !existsSync(join(dir, `${task.id}.json`)));
  mkdirSync(dir, { recursive: true });
  for (const { id, set, title, doneWhen } of missing) {
    const gate = { id, kind: "task", set, title, doneWhen, check: { type: "pending" } };
    writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(gate, null, 2)}\n`);
  }
  console.log(`created ${missing.length}, kept ${tasks.length - missing.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(resolve(process.env.READINESS_ROOT ?? join(fileURLToPath(import.meta.url), "..", "..", "..")));
}
