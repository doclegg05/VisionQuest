#!/usr/bin/env node
// Benchmark suite: offboarding-completeness (gate, no requires).
//
// Walks prisma/schema.prisma for every model with a direct `studentId` FK to
// Student, resolves which field on the Student model each one hangs off
// (matching Prisma's own relation-name disambiguation, since several models
// relate to Student more than once — Appointment/StudentTask/CaseNote/
// Connection/GoalResourceLink/FormResponse all have a second, non-studentId
// relation to Student that must not be confused with the ownership one), and
// checks whether src/lib/student-archive.ts's generateStudentArchive() reads
// that field. A model whose data belongs to one specific student but that the
// export-before-deactivate archive never touches is a real privacy/retention
// gap: if that data is ever purged (today's offboarding flow deactivates but
// does not delete — see the route's own comment — a future retention pass
// might), the student's only copy is gone and nobody would have noticed it
// was missing.
//
// See config/benchmarks/fixtures/archive-exemptions.json for the contract on
// exempting a model (non-personal bookkeeping or a fully derivable value
// only — never because adding it is inconvenient).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const SCHEMA_PATH = path.join(REPO_ROOT, "prisma/schema.prisma");
const ARCHIVE_PATH = path.join(REPO_ROOT, "src/lib/student-archive.ts");
const EXEMPTIONS_PATH = path.join(
  REPO_ROOT,
  "config/benchmarks/fixtures/archive-exemptions.json",
);

function parseModelBlocks(schemaText) {
  const blocks = {};
  const re = /(?:^|\n)model\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(schemaText)) !== null) {
    blocks[m[1]] = m[2];
  }
  return blocks;
}

/** Models with a scalar `studentId` field, excluding Student itself. */
function findStudentIdModels(blocks) {
  return Object.entries(blocks)
    .filter(([name, body]) => name !== "Student" && /^\s*studentId\s+String\??/m.test(body))
    .map(([name]) => name);
}

/**
 * The relation name a child model's own `@relation(fields: [studentId], ...)`
 * declares, or null for Prisma's default (unnamed) relation — which is legal
 * only when there is exactly one relation between the two models.
 */
function findChildRelationName(childBody) {
  const m = childBody.match(/@relation\((?:"([^"]+)",\s*)?fields:\s*\[studentId\]/);
  return m ? (m[1] ?? null) : undefined; // undefined = no such relation line found at all
}

/** Every field on Student whose type is `childModel` or `childModel[]`, with its relation name if any. */
function findStudentFieldsForModel(studentBody, childModel) {
  const lineRe = new RegExp(
    `^\\s*([A-Za-z0-9_]+)\\s+${childModel}(?:\\[\\])?\\??\\s*(?:@relation\\(\\s*(?:"([^"]+)")?[^)]*\\))?`,
    "gm",
  );
  const out = [];
  let m;
  while ((m = lineRe.exec(studentBody)) !== null) {
    out.push({ field: m[1], relationName: m[2] ?? null });
  }
  return out;
}

/** Resolve which Student field is the studentId ownership relation for `model`. */
function resolveOwnerField(blocks, model) {
  const childBody = blocks[model];
  const studentBody = blocks.Student;
  const relName = findChildRelationName(childBody);
  const candidates = findStudentFieldsForModel(studentBody, model);

  if (candidates.length === 0) return { field: null, ambiguous: false, unresolved: true };
  if (candidates.length === 1) return { field: candidates[0].field, ambiguous: false };

  // Multiple relations between Student and this model — disambiguate by name.
  const match = candidates.find((c) => c.relationName === (relName ?? null));
  if (match) return { field: match.field, ambiguous: false };
  return { field: candidates[0].field, ambiguous: true, candidates };
}

function loadExemptions() {
  try {
    const raw = JSON.parse(readFileSync(EXEMPTIONS_PATH, "utf8"));
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith("_")) continue;
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export async function run(_ctx) {
  const schemaText = readFileSync(SCHEMA_PATH, "utf8");
  const archiveText = readFileSync(ARCHIVE_PATH, "utf8");
  const blocks = parseModelBlocks(schemaText);
  const studentIdModels = findStudentIdModels(blocks).sort();
  const exemptions = loadExemptions();

  const notExported = [];
  const unresolved = [];
  const ambiguous = [];

  for (const model of studentIdModels) {
    const resolved = resolveOwnerField(blocks, model);
    if (resolved.unresolved) {
      unresolved.push(model);
      continue;
    }
    if (resolved.ambiguous) ambiguous.push({ model, picked: resolved.field });

    const fieldRe = new RegExp(`\\b${resolved.field}\\s*:`);
    const isExported = fieldRe.test(archiveText);
    if (!isExported) notExported.push({ model, studentField: resolved.field });
  }

  const exempted = notExported.filter((e) => Object.hasOwn(exemptions, e.model));
  const reported = notExported.filter((e) => !Object.hasOwn(exemptions, e.model));

  return {
    metrics: [
      {
        id: "student_linked_models_not_exported",
        value: reported.length,
        n: studentIdModels.length,
        details: {
          totalStudentLinkedModels: studentIdModels.length,
          exempted: exempted.map((e) => ({ model: e.model, reason: exemptions[e.model] })),
          reported: reported.map((e) => e.model),
          // Parser diagnostics — should be empty on a clean run; a non-empty
          // list means the schema grew a shape this parser doesn't handle yet
          // and the result above should not be trusted without a manual check.
          unresolved,
          ambiguous,
        },
      },
    ],
  };
}

if (process.argv.includes("--self-test")) {
  run({ fixture: null, fixturePath: EXEMPTIONS_PATH, env: {}, log: console.log, now: () => new Date() })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      const metric = result.metrics[0];
      if (metric.details.unresolved.length > 0 || metric.details.ambiguous.length > 0) {
        console.error(
          "FAIL: parser could not cleanly resolve every studentId model to a Student field — " +
            "see details.unresolved / details.ambiguous above.",
        );
        process.exit(1);
      }
      // This suite is `tier: watch` today (30 real gaps reported, per the
      // fixture header) — self-test only proves the parser runs cleanly, not
      // that the count is zero.
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
