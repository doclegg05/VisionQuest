/**
 * Demo closeout (readiness H10): what this checkout says about the schema.
 *
 * The closeout counts every table the generated Prisma client knows, before
 * and after it deletes. A checkout that is behind the database, or a client
 * generated before the last pull, would leave a table out of that count. So
 * the tool compares every migration folder here with every migration the
 * database has applied, and the schema file's models with the client's. A set,
 * not the newest name: a migration can be applied out of order, and a
 * database can miss an older one while its newest name still agrees.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface LocalSchema {
  /** Every folder in prisma/migrations, sorted by name. Empty when the folder is missing. */
  readonly migrations: readonly string[];
  /** The model names in prisma/schema.prisma. Empty when the file cannot be read. */
  readonly schemaModels: readonly string[];
}

const MODEL_LINE = /^model\s+(\w+)\s*\{/gm;

function migrationsIn(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    // Not an error to report: no folder means no migration, and the closeout refuses with schema_mismatch.
    return [];
  }
}

function modelsIn(schemaFile: string): string[] {
  try {
    return [...readFileSync(schemaFile, "utf8").matchAll(MODEL_LINE)].map((match) => match[1]);
  } catch {
    // As above: an unreadable schema file is a mismatch, and the closeout refuses.
    return [];
  }
}

/** Reads the checkout at `root`. Never throws: anything it cannot read becomes a mismatch. */
export function readLocalSchema(root: string): LocalSchema {
  return {
    migrations: migrationsIn(path.join(root, "prisma", "migrations")),
    schemaModels: modelsIn(path.join(root, "prisma", "schema.prisma")),
  };
}
