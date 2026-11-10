/**
 * Demo closeout (readiness H10): what this checkout says about the schema.
 *
 * The closeout counts every table the generated Prisma client knows, before
 * and after it deletes. A checkout that is behind the database, or a client
 * generated before the last pull, would leave a table out of that count. So
 * the tool compares the newest migration folder here with the newest one the
 * database has applied, and the schema file's models with the client's.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface LocalSchema {
  /** The newest folder in prisma/migrations by name, or null when the folder is missing or empty. */
  readonly newestMigration: string | null;
  /** The model names in prisma/schema.prisma. Empty when the file cannot be read. */
  readonly schemaModels: readonly string[];
}

const MODEL_LINE = /^model\s+(\w+)\s*\{/gm;

function newestMigrationIn(folder: string): string | null {
  try {
    const names = readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    // Byte order, the same order the database is asked for (closeout.server.ts).
    return names.sort().at(-1) ?? null;
  } catch {
    // Not an error to report: no folder means no migration, and the closeout refuses with schema_mismatch.
    return null;
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
    newestMigration: newestMigrationIn(path.join(root, "prisma", "migrations")),
    schemaModels: modelsIn(path.join(root, "prisma", "schema.prisma")),
  };
}
